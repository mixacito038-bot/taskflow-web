'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DC = require('../src/services/device-code');

test('「/」及常见写法归一；真实编码原样（去首尾空白）', () => {
  for (const v of ['/', ' / ', '／', '、', '\\', '无', '没有', '暂无', '不适用', '-', '－', '—', '–', 'N/A', 'n/a', '　无　']) {
    assert.equal(DC.normNone(v), '/', JSON.stringify(v));
  }
  assert.equal(DC.normNone('  JZ-CD-001 '), 'JZ-CD-001');
  assert.equal(DC.normNone('A/B'), 'A/B', '含「/」的真实编码不动');
  assert.equal(DC.normNone('无锡-01'), '无锡-01');
  assert.equal(DC.normNone(''), '');
  assert.equal(DC.normNone(null), '');
  assert.equal(DC.normNone(12345), '12345');
});

test('判重只看真实值；称呼与排序', () => {
  assert.deepEqual(['', '/', 'SN1'].map(DC.isReal), [false, false, true]);
  assert.equal(DC.devLabel({ code: 'JZ-1', name: '除颤仪' }), 'JZ-1 除颤仪');
  assert.equal(DC.devLabel({ code: '/', name: '简易呼吸器' }), '简易呼吸器');
  // 没有编码的排在后面；名称按字符编码比（和数据库 ORDER BY name 一致）：吸 U+5438 < 简 U+7B80
  const l = [{ code: '/', name: '简易呼吸器' }, { code: 'B-1', name: 'x' }, { code: '/', name: '吸痰器' }, { code: 'A-1', name: 'y' }];
  assert.deepEqual(l.sort(DC.byCode).map(d => d.code + d.name), ['A-1y', 'B-1x', '/吸痰器', '/简易呼吸器']);
});
