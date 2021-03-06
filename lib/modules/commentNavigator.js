/* @flow */

import _ from 'lodash';
import commentNavigatorTemplate from '../templates/commentNavigator.mustache';
import { $ } from '../vendor';
import { Module } from '../core/module';
import { downcast, loggedInUser, getHeaderOffset, scrollTo } from '../utils';
import * as Floater from './floater';
import * as UserInfo from './userInfo';

export const module: Module<*> = new Module('commentNavigator');

module.moduleName = 'commentNavName';
module.category = 'commentsCategory';
module.description = 'commentNavDesc';
module.options = {
	showByDefault: {
		type: 'boolean',
		value: false,
		description: 'Display Comment Navigator by default',
	},
	openOnHighlightUser: {
		type: 'boolean',
		value: true,
		description: 'Display Comment Navigator when a user is highlighted',
		advanced: true,
	},
};
module.include = [
	'comments',
];

const _posts = {};
const _nav = {};
let commentNavBox, navSelect, commentNavPostCount, commentNavButtons, commentNavUp, commentNavDown;

module.beforeLoad = () => {
	// draw the commentNav box
	commentNavBox = $('<div>', {
		id: 'REScommentNavBox',
		class: 'RESDialogSmall',
		html: commentNavigatorTemplate(),
	})[0];

	navSelect = downcast(commentNavBox.querySelector('#commentNavBy'), HTMLSelectElement);
	commentNavPostCount = commentNavBox.querySelector('#commentNavPostCount');
	commentNavButtons = commentNavBox.querySelector('#commentNavButtons');
	commentNavBox.querySelector('#commentNavCloseButton').addEventListener('click', () => hideNavigator());
	commentNavUp = downcast(commentNavBox.querySelector('#commentNavUp'), HTMLButtonElement);
	commentNavUp.addEventListener('click', moveUp);
	commentNavDown = downcast(commentNavBox.querySelector('#commentNavDown'), HTMLButtonElement);
	commentNavDown.addEventListener('click', moveDown);
	navSelect.addEventListener('change', changeCategory);
};

const sortTypes = {
	submitter: {
		title: 'Navigate comments made by the post submitter',
		getPosts: () => document.querySelectorAll('.noncollapsed a.author.submitter'),
	},
	moderator: {
		title: 'Navigate comments made by moderators',
		getPosts: () => document.querySelectorAll('.noncollapsed a.author.moderator'),
	},
	friend: {
		title: 'Navigate comments made by users on your friends list',
		getPosts: () => document.querySelectorAll('.noncollapsed a.author.friend'),
	},
	me: {
		title: 'Navigate comments made by you',
		getPosts: () => {
			const loggedIn = loggedInUser();
			return loggedIn ? document.querySelectorAll(`.noncollapsed a.author[href$="/user/${loggedIn}"]`) : [];
		},
	},
	admin: {
		title: 'Navigate comments made by reddit admins',
		getPosts: () => document.querySelectorAll('.noncollapsed a.author.admin'),
	},
	highlighted: {
		title: 'Navigate comments made by highlighted user',
		getPosts() {
			const highlightedUserSelector = Object.keys(UserInfo.highlightedUsers)
				.map(key => `.noncollapsed .author.id-t2_${key}`)
				.join(', ');
			return highlightedUserSelector ? document.querySelectorAll(highlightedUserSelector) : [];
		},
	},
	tagged: {
		title: 'Navigate comments made by tagged users',
		getPosts: () => document.querySelectorAll('.noncollapsed .tagline .userTagLink.hasTag'),
	},
	gilded: {
		title: 'Navigate through gilded comments',
		getPosts: () => document.querySelectorAll('.noncollapsed .gilded-icon'),
	},
	IAmA: {
		title: 'Navigate through questions that have been answered by the submitter (most useful in /r/IAmA)',
		getPosts() {
			const submitterPosts = document.querySelectorAll('.noncollapsed a.author.submitter');
			return Array.from(submitterPosts)
				.map(post => $(post).closest('.comment').parent().closest('.comment').get(0))
				.filter(x => x);
		},
	},
	images: {
		title: 'Navigate through comments with images',
		getPosts: () => document.querySelectorAll('.expando-button.image'),
	},
	videos: {
		title: 'Navigate through comments with videos',
		getPosts: () => document.querySelectorAll('.expando-button.video'),
	},
	popular: {
		title: 'Navigate through comments in order of highest vote total',
		getPosts() {
			const allComments = document.querySelectorAll('.noncollapsed');
			return Array.from(allComments)
				.map(comment => {
					const thisScore = comment.querySelector('.score.unvoted');
					let score = 0;
					if (thisScore) {
						const scoreSplit = thisScore.textContent.split(' ');
						score = parseInt(scoreSplit[0], 10);
					}

					return {
						comment,
						score,
					};
				})
				.sort((a, b) => b.score - a.score)
				.map(commentObj => commentObj.comment);
		},
	},
	new: {
		title: 'Navigate through new comments (Reddit Gold users only)',
		getPosts: () => document.querySelectorAll('.new-comment'),
	},
};

module.go = () => {
	const commentArea = document.body.querySelector('.commentarea .menuarea');
	if (commentArea) {
		const commentNavToggle = $('<div id="REScommentNavToggle"><span>navigate by:</span></div>').get(0);

		Object.entries(sortTypes).forEach(([category, { title }], i) => {
			const thisEle = $('<div>', {
				id: `navigateBy${category}`,
				class: 'commentNavSortType noCtrlF',
				text: category,
				title,
				attr: { index: i + 1 },
			}).get(0);

			let isGold;
			if (category === 'new') {
				isGold = document.body.querySelector('.gold-accent.comment-visits-box');
				if (isGold) {
					thisEle.setAttribute('style', 'color: #9A7D2E;');
				} else {
					thisEle.classList.add('commentNavSortTypeDisabled');
				}
			}
			if (category !== 'new' || isGold) {
				thisEle.addEventListener('click', () => { showNavigator(category); });
			}
			commentNavToggle.appendChild(thisEle);
		});

		commentArea.appendChild(commentNavToggle, commentArea.firstChild);
		if (!(module.options.showByDefault.value)) {
			hideNavigator();
		}

		Floater.addElement(commentNavBox, { separate: true });
		window.addEventListener('scroll', _.debounce(onScroll, 300));
	}
};

let currentCategory = '';

function onScroll() {
	const category = currentCategory;
	if (category) {
		const posts = _posts[category];
		const inx = Array.from(posts).findIndex(post => {
			const fromViewportTop = post.getBoundingClientRect().top - getHeaderOffset();
			return post.offsetParent && fromViewportTop >= 0;
		});
		if (inx >= 0) setNavIndex(inx);
	}
}

function changeCategory() {
	const index = navSelect.selectedIndex;
	if (index === -1) {
		return;
	}
	currentCategory = (navSelect.options.item(index).value: any);
	if (currentCategory !== '') {
		getPostsByCategory();
		commentNavButtons.style.display = 'block';
	} else {
		commentNavButtons.style.display = 'none';
	}
	$('#commentNavBy').blur();
}

let isOpen = false;

export function showNavigator(category: $Keys<typeof sortTypes> | '' = currentCategory) {
	isOpen = true;
	commentNavBox.style.display = 'block';

	if (isNaN(category)) {
		navSelect.value = category;
	} else if (typeof category === 'number') {
		navSelect.selectedIndex = category;
	} else if (!isNaN(parseInt(category, 10))) {
		navSelect.selectedIndex = parseInt(category, 10);
	}
	$('#commentNavBy').focus();
	changeCategory();
}

export function hideNavigator() {
	isOpen = false;
	commentNavBox.style.display = 'none';
}

export function toggleNavigator() {
	if (isOpen) {
		hideNavigator();
	} else {
		showNavigator();
	}
}

export function getPostsByCategory() {
	if (currentCategory) {
		if (!_posts[currentCategory] || currentCategory === 'highlighted') {
			_posts[currentCategory] = sortTypes[currentCategory].getPosts();
		}
		resetNavigator(currentCategory);
	}
}

function resetNavigator(category) {
	_nav[category] = 0;
	if (_posts[category] && _posts[category].length) {
		scrollToNavElement();
		commentNavUp.disabled = false;
		commentNavDown.disabled = false;
		commentNavButtons.classList.remove('noNav');
	} else {
		commentNavPostCount.textContent = 'none';
		commentNavUp.disabled = true;
		commentNavDown.disabled = true;
		commentNavButtons.classList.add('noNav');
	}
}

export function moveUp() {
	const category = currentCategory;
	if (!category) {
		showNavigator();
		return;
	}

	if (_posts[category].length) {
		if (_nav[category] > 0) {
			_nav[category]--;
		} else {
			_nav[category] = _posts[category].length - 1;
		}
		scrollToNavElement();
	}
}

export function moveDown() {
	const category = currentCategory;
	if (!category) {
		showNavigator();
		return;
	}

	if (_posts[category].length) {
		if (_nav[category] < _posts[category].length - 1) {
			_nav[category]++;
		} else {
			_nav[category] = 0;
		}
		scrollToNavElement();
	}
}

function setNavIndex(idx) {
	const category = currentCategory;
	_nav[category] = idx;
	$(commentNavPostCount).text(`${_nav[category] + 1}/${_posts[category].length}`);
}

function scrollToNavElement() {
	const category = currentCategory;
	setNavIndex(_nav[category]);
	const { top } = $(_posts[category][_nav[category]]).offset();
	scrollTo(0, top);
}
