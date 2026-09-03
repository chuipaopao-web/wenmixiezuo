import assert from 'node:assert/strict';
import test from 'node:test';
import { V7_NARRATIVE_METHODS } from './narrative-method-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import {
  NOMINATION_CARD_MAX_CHARS,
  V7_RECIPE_NOMINATION_CARDS,
  getMethodNominationCard,
  getRecipeNominationCard,
  nominationCardText,
  validateNominationCards
} from './method-nomination-cards.js';

test('提名卡校验全通过：两组方法组与全部配方都配卡且不超字', () => {
  assert.deepEqual(validateNominationCards(), []);
});

test('宏观节奏框架与全书形态两组方法逐 key 配卡，文本不超上限', () => {
  for (const group of ['macro-framework', 'book-topology']) {
    const methods = V7_NARRATIVE_METHODS.filter((item) => item.exclusiveGroup === group);
    assert.ok(methods.length > 0, `${group} 组不应为空`);
    for (const method of methods) {
      const nomination = getMethodNominationCard(method.key);
      assert.ok(nomination !== null, `${method.key} 缺提名卡`);
      const text = nominationCardText(method.professionalName, nomination);
      assert.ok(text.length <= NOMINATION_CARD_MAX_CHARS, `${method.key} 提名卡超 ${NOMINATION_CARD_MAX_CHARS} 字`);
      assert.match(text, /。注意：/u, `${method.key} 提名卡缺少防误读句`);
    }
  }
});

test('全部剧情配方逐 key 配卡，数量与配方库一致', () => {
  assert.equal(Object.keys(V7_RECIPE_NOMINATION_CARDS).length, V7_PLOT_RECIPES.length);
  for (const recipe of V7_PLOT_RECIPES) {
    const nomination = getRecipeNominationCard(recipe.key);
    assert.ok(nomination !== null, `${recipe.key} 缺提名卡`);
    assert.ok(nominationCardText(recipe.publicTitle, nomination).length <= NOMINATION_CARD_MAX_CHARS);
  }
});

test('提名卡文本结构固定为"名字：节奏线。注意：防误读。"，未知 key 返回 null', () => {
  const nomination = getMethodNominationCard('three-act');
  assert.ok(nomination !== null);
  const text = nominationCardText('三幕结构', nomination);
  assert.equal(text, `三幕结构：${nomination.stageRhythm}。注意：${nomination.guard}`);
  assert.equal(getMethodNominationCard('not-a-method'), null);
  assert.equal(getRecipeNominationCard('not-a-recipe'), null);
});
