import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, normalizeState, selectQuestions, recordAnswer, toggleFavorite,
  importBackup, exportBackup, getStats, shuffle, getQuestionStatus,
} from '../dist/core.js';

const questions = [
  { id: 'q1', chapter: 'basics', topic: '算法', stem: '算法的有穷性', searchText: '算法的有穷性', answer: [1] },
  { id: 'q2', chapter: 'lists', topic: '链表', stem: '单链表插入', searchText: '单链表插入', answer: null },
  { id: 'q3', chapter: 'lists', topic: '队列', stem: '循环队列', searchText: '循环队列', answer: [0] },
];
const ids = questions.map(question => question.id);
const now = '2026-11-08T12:00:00.000Z';

test('回答后保留历史统计，答对后从当前错题集中移出', () => {
  const start = createState();
  const wrong = recordAnswer(start, 'q1', false, { answer: [0], graded: 'auto', now });
  assert.equal(getQuestionStatus(wrong, 'q1'), 'wrong');
  assert.deepEqual(selectQuestions(questions, { mode: 'wrong', chapter: 'all', topic: 'all' }, wrong).map(q => q.id), ['q1']);
  const corrected = recordAnswer(wrong, 'q1', true, { answer: [1], graded: 'auto', now });
  assert.equal(getQuestionStatus(corrected, 'q1'), 'done');
  assert.equal(corrected.records.q1.attempts, 2);
  assert.equal(corrected.records.q1.wrongCount, 1);
  assert.equal(corrected.records.q1.correctCount, 1);
  assert.equal(selectQuestions(questions, { mode: 'wrong' }, corrected).length, 0);
  assert.equal(getQuestionStatus(corrected, 'q3'), 'unanswered');
});

test('回答与收藏返回新状态，不修改旧状态或共享初始对象', () => {
  const start = createState();
  const snapshot = JSON.stringify(start);
  const answered = recordAnswer(start, 'q2', true, { graded: 'self', now });
  assert.notEqual(answered, start);
  assert.equal(JSON.stringify(start), snapshot);
  assert.equal(answered.records.q2.grading, 'self');
  const starred = toggleFavorite(answered, 'q2');
  assert.deepEqual(starred.favorites, ['q2']);
  assert.deepEqual(answered.favorites, []);
  assert.deepEqual(toggleFavorite(starred, 'q2').favorites, []);
  assert.deepEqual(createState().records, {});
});

test('知识点、章节、关键词与练习状态组合筛选', () => {
  let state = recordAnswer(createState(), 'q2', false, { graded: 'self', now });
  state = toggleFavorite(state, 'q2');
  state = toggleFavorite(state, 'q3');
  const result = selectQuestions(questions, { mode: 'favorites', chapter: 'lists', topic: '链表', query: '插入' }, state);
  assert.deepEqual(result.map(q => q.id), ['q2']);
  assert.deepEqual(selectQuestions(questions, { mode: 'unanswered', chapter: 'lists' }, state).map(q => q.id), ['q3']);
  assert.deepEqual(selectQuestions(questions, { mode: 'auto' }, state).map(q => q.id), ['q1', 'q3']);
  assert.equal(selectQuestions(questions, { query: '不存在的题目' }, state).length, 0);
});

test('备份导出导入保留有效学习记录与设置', () => {
  const state = toggleFavorite(recordAnswer(createState(), 'q1', true, { answer: [1], now }), 'q1');
  const serialized = exportBackup(state);
  const wrapper = JSON.parse(serialized);
  assert.equal(wrapper.app, 'zhixu-ds');
  assert.equal(wrapper.version, 1);
  const restored = importBackup(serialized, ids);
  assert.equal(restored.records.q1.correctCount, 1);
  assert.deepEqual(restored.records.q1.lastAnswer, [1]);
  assert.deepEqual(restored.favorites, ['q1']);
  assert.equal(restored.settings.fontSize, state.settings.fontSize);
});

test('备份拒绝损坏 JSON、错误应用标识和不兼容版本', () => {
  assert.throws(() => importBackup('{oops', ids));
  assert.throws(() => importBackup({ app: 'another-app', version: 1, data: createState() }, ids));
  assert.throws(() => importBackup({ app: 'zhixu-ds', version: 99, data: createState() }, ids));
});

test('载入数据清理未知题目和非法计数，阻止原型键进入状态', () => {
  const raw = JSON.parse('{"version":1,"records":{"q1":{"attempts":3,"wrongCount":"bad","lastCorrect":true},"q2":{"attempts":-99,"lastCorrect":false},"unknown":{"attempts":9},"__proto__":{"polluted":true}},"favorites":["q1","q1","unknown","__proto__"],"settings":{"fontSize":"bogus","autoNext":"yes"}}');
  const state = normalizeState(raw, ids);
  assert.ok(!Object.hasOwn(state.records, 'unknown'));
  assert.ok(!Object.hasOwn(state.records, '__proto__'));
  assert.ok(!Object.hasOwn(state.records, 'q2'));
  assert.deepEqual(state.favorites, ['q1']);
  assert.ok(Number.isFinite(state.records.q1.attempts) && state.records.q1.attempts >= 0);
  assert.ok(Number.isFinite(state.records.q1.wrongCount) && state.records.q1.wrongCount >= 0);
  assert.equal({}.polluted, undefined);
  assert.equal(typeof state.settings.autoNext, 'boolean');
  assert.ok(['normal', 'large'].includes(state.settings.fontSize));
});

test('总览统计区分题目数、作答次数、当前错题和收藏', () => {
  let state = recordAnswer(createState(), 'q1', false, { now });
  state = recordAnswer(state, 'q1', true, { now });
  state = recordAnswer(state, 'q2', false, { graded: 'self', now });
  state = toggleFavorite(state, 'q3');
  const stats = getStats(questions, state);
  assert.equal(stats.total, 3);
  assert.equal(stats.answered, 2);
  assert.equal(stats.mastered, 1);
  assert.equal(stats.wrong, 1);
  assert.equal(stats.favorite, 1);
  assert.equal(stats.attempts, 3);
  assert.equal(stats.correct, 1);
});

test('洗牌保持全部元素且不修改输入，可注入随机数', () => {
  const original = ['a', 'b', 'c', 'd'];
  const result = shuffle(original, () => 0);
  assert.notEqual(result, original);
  assert.deepEqual([...result].sort(), [...original].sort());
  assert.deepEqual(original, ['a', 'b', 'c', 'd']);
});
