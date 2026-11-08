// 思いつき（ノード）とつながり（リンク）の読み書き・リアルタイム購読。
// 保存先：users/{uid}/omoitsuki_nodes/{id} と users/{uid}/omoitsuki_links/{id}
// ?demo=1 で開いた時はログインせずにメモリ上の見本データで動く。
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { db } from './firebase.js';

export const isDemo = new URLSearchParams(location.search).has('demo');

const DEMO_NODES = [
  {
    id: 'n1',
    text: 'なぜ人は「正論」だけでは動かないのか？',
    type: '疑問',
    status: '理解済み',
    hitMemo: 'ゼミの組織行動論と直結。「納得感」を作るプロセスこそがHRコンサルの価値だと気づいた。',
    createdAt: Date.now() - 3600 * 1000 * 5,
    updatedAt: Date.now() - 3600 * 1000 * 2,
  },
  {
    id: 'n2',
    text: '就活の軸：人と組織の「納得感」をつくる仕事',
    type: '整理',
    status: 'チェック済み',
    hitMemo: '1人起業で仕組みを作る経験と、組織コンサルの志望理由が一本の線でつながった。',
    createdAt: Date.now() - 3600 * 1000 * 4,
    updatedAt: Date.now() - 3600 * 1000 * 1.5,
  },
  {
    id: 'n3',
    text: 'ノースサンドの社員インタビュー記事を3本読む',
    type: 'やること',
    status: '未着手',
    hitMemo: '',
    createdAt: Date.now() - 3600 * 1000 * 3,
    updatedAt: Date.now() - 3600 * 1000 * 1,
  },
  {
    id: 'n4',
    text: 'ルールを増やすと全体の遵守率が下がる（実測3.3個）',
    type: '整理',
    status: '理解済み',
    hitMemo: 'AIのルール設計だけでなく、会社のルール設計やタスク管理にもそのまま当てはまる。',
    createdAt: Date.now() - 3600 * 1000 * 2.5,
    updatedAt: Date.now() - 3600 * 1000 * 0.8,
  },
  {
    id: 'n5',
    text: 'マインドマップ（木構造）だと分野をまたぐ発見が起きにくい？',
    type: '疑問',
    status: '未着手',
    hitMemo: '就活のメモとAI開発のメモが別々の枝に分かれてしまい、共通点に気づきにくかった。',
    createdAt: Date.now() - 3600 * 1000 * 1,
    updatedAt: Date.now() - 3600 * 1000 * 0.3,
  },
];

const DEMO_LINKS = [
  { id: 'e1', source: 'n1', target: 'n2', createdAt: Date.now() - 3600 * 1000 * 2 },
  { id: 'e2', source: 'n2', target: 'n3', createdAt: Date.now() - 3600 * 1000 * 1.5 },
  { id: 'e3', source: 'n1', target: 'n4', createdAt: Date.now() - 3600 * 1000 * 1.2 },
  { id: 'e4', source: 'n4', target: 'n2', createdAt: Date.now() - 3600 * 1000 * 1 },
];

let currentUid = null;
let nodes = [];
let links = [];
let unsubNodes = null;
let unsubLinks = null;
let listeners = [];

function notify() {
  for (const cb of listeners) cb({ nodes, links });
}

export function subscribe(cb) {
  listeners.push(cb);
  cb({ nodes, links });
  return () => {
    listeners = listeners.filter(x => x !== cb);
  };
}

export function getNodes() { return nodes; }
export function getLinks() { return links; }

export function startStore(uid, onError) {
  stopStore();
  if (isDemo) {
    nodes = [...DEMO_NODES];
    links = [...DEMO_LINKS];
    notify();
    return;
  }
  currentUid = uid;
  const nodesRef = collection(db, 'users', uid, 'omoitsuki_nodes');
  const linksRef = collection(db, 'users', uid, 'omoitsuki_links');

  unsubNodes = onSnapshot(nodesRef, snap => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    nodes = list;
    notify();
  }, err => {
    if (onError) onError(err);
  });

  unsubLinks = onSnapshot(linksRef, snap => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    links = list;
    notify();
  }, err => {
    if (onError) onError(err);
  });
}

export function stopStore() {
  if (unsubNodes) { unsubNodes(); unsubNodes = null; }
  if (unsubLinks) { unsubLinks(); unsubLinks = null; }
  currentUid = null;
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function addNode({ text, type = '整理', status = '未着手', hitMemo = '' }) {
  const now = Date.now();
  const id = genId('n');
  const item = {
    id,
    text: text.trim(),
    type,
    status,
    hitMemo: hitMemo.trim(),
    createdAt: now,
    updatedAt: now,
  };
  if (isDemo) {
    nodes = [item, ...nodes];
    notify();
    return item;
  }
  const ref = doc(db, 'users', currentUid, 'omoitsuki_nodes', id);
  await setDoc(ref, {
    text: item.text,
    type: item.type,
    status: item.status,
    hitMemo: item.hitMemo,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  return item;
}

export async function updateNode(id, patch) {
  const now = Date.now();
  if (isDemo) {
    nodes = nodes.map(n => n.id === id ? { ...n, ...patch, updatedAt: now } : n);
    notify();
    return;
  }
  const ref = doc(db, 'users', currentUid, 'omoitsuki_nodes', id);
  await updateDoc(ref, { ...patch, updatedAt: now });
}

export async function removeNode(id) {
  const relatedLinks = links.filter(l => l.source === id || l.target === id);
  if (isDemo) {
    nodes = nodes.filter(n => n.id !== id);
    links = links.filter(l => l.source !== id && l.target !== id);
    notify();
    return;
  }
  await deleteDoc(doc(db, 'users', currentUid, 'omoitsuki_nodes', id));
  await Promise.all(
    relatedLinks.map(l => deleteDoc(doc(db, 'users', currentUid, 'omoitsuki_links', l.id)))
  );
}

export async function addLink(source, target) {
  if (!source || !target || source === target) return null;
  const exists = links.some(l =>
    (l.source === source && l.target === target) ||
    (l.source === target && l.target === source)
  );
  if (exists) return null;

  const now = Date.now();
  const id = genId('e');
  const item = { id, source, target, createdAt: now };
  if (isDemo) {
    links = [...links, item];
    notify();
    return item;
  }
  const ref = doc(db, 'users', currentUid, 'omoitsuki_links', id);
  await setDoc(ref, { source, target, createdAt: now });
  return item;
}

export async function removeLink(id) {
  if (isDemo) {
    links = links.filter(l => l.id !== id);
    notify();
    return;
  }
  await deleteDoc(doc(db, 'users', currentUid, 'omoitsuki_links', id));
}
