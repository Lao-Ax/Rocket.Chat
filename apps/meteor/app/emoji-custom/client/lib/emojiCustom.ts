import type { IEmoji } from '@rocket.chat/core-typings';
import { escapeRegExp } from '@rocket.chat/string-helpers';
import { Meteor } from 'meteor/meteor';
import { Session } from 'meteor/session';

import { emoji, updateRecent } from '../../../emoji/client';
import { CachedCollectionManager } from '../../../ui-cached-collection/client';
import { getURL } from '../../../utils/client';
import { sdk } from '../../../utils/client/lib/SDKClient';

const isSetNotNull = (fn: () => unknown) => {
	let value;
	try {
		value = fn();
	} catch (e) {
		value = null;
	}
	return value !== null && value !== undefined;
};

const getEmojiUrlFromName = (name: string, extension: string) => {
	if (name == null) {
		return;
	}

	const key = `emoji_random_${name}` as const;

	const random = (Session as unknown as { keys: Record<string, any> }).keys[key] ?? 0;

	return getURL(`/emoji-custom/${encodeURIComponent(name)}.${extension}?_dc=${random}`);
};

export const deleteEmojiCustom = (emojiData: IEmoji) => {
	delete emoji.list[`:${emojiData.name}:`];
	const arrayIndex = emoji.packages.emojiCustom.emojisByCategory.rocket.indexOf(emojiData.name);
	if (arrayIndex !== -1) {
		emoji.packages.emojiCustom.emojisByCategory.rocket.splice(arrayIndex, 1);
	}
	const arrayIndexList = emoji.packages.emojiCustom.list?.indexOf(`:${emojiData.name}:`) ?? -1;
	if (arrayIndexList !== -1) {
		emoji.packages.emojiCustom.list?.splice(arrayIndexList, 1);
	}
	if (emojiData.aliases) {
		for (const alias of emojiData.aliases) {
			delete emoji.list[`:${alias}:`];
			const aliasIndex = emoji.packages.emojiCustom.list?.indexOf(`:${alias}:`) ?? -1;
			if (aliasIndex !== -1) {
				emoji.packages.emojiCustom.list?.splice(aliasIndex, 1);
			}
		}
	}
	updateRecent(['rocket']);
};

export const updateEmojiCustom = (emojiData: IEmoji) => {
	const previousExists = isSetNotNull(() => emojiData.previousName);
	const currentAliases = isSetNotNull(() => emojiData.aliases);

	if (previousExists && isSetNotNull(() => emoji.list[`:${emojiData.previousName}:`].aliases)) {
		for (const alias of emoji.list[`:${emojiData.previousName}:`].aliases ?? []) {
			delete emoji.list[`:${alias}:`];
			const aliasIndex = emoji.packages.emojiCustom.list?.indexOf(`:${alias}:`) ?? -1;
			if (aliasIndex !== -1) {
				emoji.packages.emojiCustom.list?.splice(aliasIndex, 1);
			}
		}
	}

	if (previousExists && emojiData.name !== emojiData.previousName) {
		const arrayIndex = emoji.packages.emojiCustom.emojisByCategory.rocket.indexOf(emojiData.previousName);
		if (arrayIndex !== -1) {
			emoji.packages.emojiCustom.emojisByCategory.rocket.splice(arrayIndex, 1);
		}
		const arrayIndexList = emoji.packages.emojiCustom.list?.indexOf(`:${emojiData.previousName}:`) ?? -1;
		if (arrayIndexList !== -1) {
			emoji.packages.emojiCustom.list?.splice(arrayIndexList, 1);
		}
		delete emoji.list[`:${emojiData.previousName}:`];
	}

	const categoryIndex = emoji.packages.emojiCustom.emojisByCategory.rocket.indexOf(`${emojiData.name}`);
	if (categoryIndex === -1) {
		emoji.packages.emojiCustom.emojisByCategory.rocket.push(`${emojiData.name}`);
		emoji.packages.emojiCustom.list?.push(`:${emojiData.name}:`);
	}
	emoji.list[`:${emojiData.name}:`] = Object.assign({ emojiPackage: 'emojiCustom' }, emoji.list[`:${emojiData.name}:`], emojiData);
	if (currentAliases) {
		for (const alias of emojiData.aliases) {
			emoji.packages.emojiCustom.list?.push(`:${alias}:`);
			emoji.list[`:${alias}:`] = {
				emojiPackage: 'emojiCustom',
				aliasOf: emojiData.name,
			};
		}
	}

	updateRecent(['rocket']);
};

const customRender = (html: string) => {
	const emojisMatchGroup = emoji.packages.emojiCustom.list?.map(escapeRegExp).join('|');
	if (emojisMatchGroup !== emoji.packages.emojiCustom._regexpSignature) {
		emoji.packages.emojiCustom._regexpSignature = emojisMatchGroup;
		emoji.packages.emojiCustom._regexp = new RegExp(
			`<object[^>]*>.*?<\/object>|<span[^>]*>.*?<\/span>|<(?:object|embed|svg|img|div|span|p|a)[^>]*>|(${emojisMatchGroup})`,
			'gi',
		);
	}

	html = html.replace(emoji.packages.emojiCustom._regexp!, (shortname) => {
		if (typeof shortname === 'undefined' || shortname === '' || (emoji.packages.emojiCustom.list?.indexOf(shortname) ?? -1) === -1) {
			return shortname;
		}

		let emojiAlias = shortname.replace(/:/g, '');

		let dataCheck = emoji.list[shortname];
		if (dataCheck.aliasOf) {
			emojiAlias = dataCheck.aliasOf;
			dataCheck = emoji.list[`:${emojiAlias}:`];
		}

		return `<span class="emoji" style="background-image:url(${getEmojiUrlFromName(
			emojiAlias,
			dataCheck.extension!,
		)});" data-emoji="${emojiAlias}" title="${shortname}">${shortname}</span>`;
	});

	return html;
};

emoji.packages.emojiCustom = {
	emojiCategories: [{ key: 'rocket', i18n: 'Custom' }],
	categoryIndex: 1,
	toneList: {},
	list: [],
	_regexpSignature: null,
	_regexp: null,
	emojisByCategory: {},
	render: customRender,
	renderPicker: customRender,
};

Meteor.startup(() =>
	CachedCollectionManager.onLogin(async () => {
		try {
			const {
				emojis: { update: emojis },
			} = await sdk.rest.get('/v1/emoji-custom.list', { query: '' });

			emoji.packages.emojiCustom.emojisByCategory = { rocket: [] };
			for (const currentEmoji of emojis) {
				emoji.packages.emojiCustom.emojisByCategory.rocket.push(currentEmoji.name);
				emoji.packages.emojiCustom.list?.push(`:${currentEmoji.name}:`);
				emoji.list[`:${currentEmoji.name}:`] = { ...currentEmoji, emojiPackage: 'emojiCustom' } as any;
				for (const alias of currentEmoji.aliases) {
					emoji.packages.emojiCustom.list?.push(`:${alias}:`);
					emoji.list[`:${alias}:`] = {
						emojiPackage: 'emojiCustom',
						aliasOf: currentEmoji.name,
					};
				}
			}
		} catch (e) {
			console.error('Error getting custom emoji', e);
		}
	}),
);
