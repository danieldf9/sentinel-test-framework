import { describe, expect, it } from 'vitest';
import {
  assertionTextSimilarity,
  fingerprintSimilarity,
  levenshtein,
  stringSimilarity,
  tokenSimilarity,
} from '../src/similarity.js';
import { makeFp } from './helpers.js';

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  it('handles strings longer than the initial row buffer', () => {
    const a = 'x'.repeat(200);
    const b = 'x'.repeat(150) + 'y'.repeat(50);
    expect(levenshtein(a, b)).toBe(50);
    // Buffer reuse across calls must not leak state between invocations.
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('tokenSimilarity', () => {
  it('tolerates inserted words', () => {
    expect(tokenSimilarity('Place order', 'Place your order')).toBeGreaterThan(0.8);
  });
  it('is zero for disjoint labels', () => {
    expect(tokenSimilarity('Add to cart', 'Sign out')).toBeLessThan(0.2);
  });
  it('handles class token lists', () => {
    expect(tokenSimilarity(['btn', 'btn-order'], ['btn', 'order-btn'])).toBe(1);
  });
});

describe('stringSimilarity', () => {
  it('normalizes whitespace and case', () => {
    expect(stringSimilarity('  Add  To Cart ', 'add to cart')).toBe(1);
  });
});

describe('fingerprintSimilarity', () => {
  it('scores a drifted-but-same element above the Tier 1 threshold', () => {
    const stored = makeFp({
      name: 'Place order',
      text: 'Place order',
      testId: 'place-order',
      classes: ['btn', 'btn-order'],
      attributes: { type: 'submit' },
      nearbyText: 'Email you@example.com We will email your receipt. Place order',
    });
    const drifted = makeFp({
      name: 'Place your order',
      text: 'Place your order',
      testId: null,
      classes: ['btn', 'order-btn'],
      attributes: { type: 'submit' },
      nearbyText: 'Email address We will email your receipt. Place your order',
      cssPath: 'body > main:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(1)',
    });
    expect(fingerprintSimilarity(stored, drifted).score).toBeGreaterThanOrEqual(0.85);
  });

  it('scores a genuinely different element well below the apply floor', () => {
    const stored = makeFp({
      name: 'Order confirmed',
      text: 'Order confirmed',
      tag: 'div',
      role: null,
      id: 'order-confirmation',
      classes: ['confirmation'],
    });
    const other = makeFp({
      name: 'Place order',
      text: 'Place order',
      attributes: { type: 'submit' },
      classes: ['btn', 'btn-order'],
    });
    expect(fingerprintSimilarity(stored, other).score).toBeLessThan(0.6);
  });

  it('disambiguates sibling widgets by nearby text', () => {
    const stored = makeFp({
      name: 'Add to cart',
      text: 'Add to cart',
      nearbyText: 'Aurora Desk Lamp $49 Add to cart',
    });
    const correct = makeFp({
      name: 'Add to cart',
      text: 'Add to cart',
      classes: ['button-cta'],
      nearbyText: 'Aurora Desk Lamp $49 Add to cart',
    });
    const sibling = makeFp({
      name: 'Add to cart',
      text: 'Add to cart',
      classes: ['button-cta'],
      nearbyText: 'Nimbus Lounge Chair $129 Add to cart',
      cssPath: 'body > main:nth-of-type(1) > button:nth-of-type(2)',
    });
    const a = fingerprintSimilarity(stored, correct).score;
    const b = fingerprintSimilarity(stored, sibling).score;
    expect(a).toBeGreaterThan(b);
    expect(a - b).toBeGreaterThan(0.03);
  });

  it('redistributes weight for fields absent on both sides', () => {
    const stored = makeFp({ tag: 'input', role: 'textbox', name: 'Email', text: '' });
    const same = makeFp({ tag: 'input', role: 'textbox', name: 'Email', text: '' });
    expect(fingerprintSimilarity(stored, same).score).toBeGreaterThan(0.95);
  });
});

describe('non-Latin scripts', () => {
  // Regression: an ASCII-only tokenizer produced zero tokens for these scripts,
  // and "both empty" scored 1.0 — unrelated labels looked identical.
  const btn = (name: string, nearbyText: string) => makeFp({ name, text: name, nearbyText });

  it.each([
    ['Chinese', btn('加入购物车', '购物车商品'), btn('删除账户', '个人资料设置')],
    ['Japanese', btn('カートに追加', '商品一覧'), btn('アカウント削除', 'プロフィール設定')],
    ['Russian', btn('Купить', 'Корзина товаров'), btn('Удалить аккаунт', 'Настройки профиля')],
    ['Hindi', btn('कार्ट में जोड़ें', 'उत्पाद सूची'), btn('खाता हटाएं', 'प्रोफ़ाइल सेटिंग्स')],
    ['Arabic', btn('أضف إلى السلة', 'قائمة المنتجات'), btn('حذف الحساب', 'إعدادات الملف')],
  ])('%s: unrelated elements score below the apply floor', (_script, stored, other) => {
    expect(fingerprintSimilarity(stored, other).score).toBeLessThan(0.6);
  });

  it.each([
    [
      'Chinese',
      btn('加入购物车', '台灯 ¥49 加入购物车'),
      btn('加入购物车按钮', '台灯 ¥49 加入购物车'),
    ],
    ['Russian', btn('Оформить заказ', 'Ваш заказ'), btn('Оформить ваш заказ', 'Ваш заказ')],
  ])('%s: a reworded-but-same element still clears Tier 1', (_script, stored, drifted) => {
    expect(fingerprintSimilarity(stored, drifted).score).toBeGreaterThanOrEqual(0.85);
  });

  it('tokenizes unspaced scripts as bigrams and keeps combining marks in words', () => {
    expect(tokenSimilarity('加入购物车', '加入购物车按钮')).toBeGreaterThan(0.8);
    expect(tokenSimilarity('加入购物车', '删除账户')).toBe(0);
    expect(tokenSimilarity('कार्ट में जोड़ें', 'कार्ट में जोड़ें')).toBe(1);
  });

  it('folds full-width and decomposed forms', () => {
    expect(stringSimilarity('ＯＫ', 'ok')).toBe(1);
    expect(stringSimilarity('Cafe\u0301', 'Caf\u00e9')).toBe(1);
  });

  it('symbol-only labels match only when identical', () => {
    expect(tokenSimilarity('+', '×')).toBe(0);
    expect(tokenSimilarity('+', '+')).toBe(1);
    expect(fingerprintSimilarity(btn('🛒', ''), btn('🗑', '')).score).toBeLessThan(0.6);
    expect(stringSimilarity('🛒', '🗑')).toBe(0);
  });

  it('assertion guard rejects different non-Latin content', () => {
    const stored = makeFp({ text: '订单已确认', tag: 'div', role: null });
    const wrong = makeFp({ text: '支付失败', tag: 'div', role: null });
    expect(assertionTextSimilarity(stored, wrong)).toBeLessThan(0.5);
    const ruStored = makeFp({ text: 'Заказ подтверждён', tag: 'div', role: null });
    const ruWrong = makeFp({ text: 'Оплата не прошла', tag: 'div', role: null });
    expect(assertionTextSimilarity(ruStored, ruWrong)).toBeLessThan(0.5);
  });
});

describe('assertionTextSimilarity (golden rule support)', () => {
  it('flags content mismatch on assertion targets', () => {
    const stored = makeFp({ text: 'Order confirmed', tag: 'div', role: null });
    const wrong = makeFp({ text: 'Payment failed', tag: 'div', role: null });
    expect(assertionTextSimilarity(stored, wrong)).toBeLessThan(0.5);
  });
  it('passes when content is preserved', () => {
    const stored = makeFp({ text: 'Order confirmed', tag: 'div', role: null });
    const same = makeFp({ text: 'Order confirmed', tag: 'div', role: null, id: 'renamed' });
    expect(assertionTextSimilarity(stored, same)).toBe(1);
  });
});
