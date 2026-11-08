# 思いつきマップ (omoitsuki-map)

思いついたことを素早くリストに書き留め、それらのつながりを「関係図（グラフ）」として眺められる自分専用のWebアプリ。

- 公開URL：https://kazuhiro5.github.io/omoitsuki-map/
- 中身：HTML / CSS / JavaScript（ビルドなし）＋ Cytoscape.js ＋ Firebase（Googleログイン・Firestore `task-board-kz` 共用）
- データは本人のGoogleアカウントでログインした時だけ読み書きできる（`users/{uid}/omoitsuki_nodes` および `omoitsuki_links`）

## ローカルで動かす

```bash
python -m http.server 8766
```

`http://localhost:8766/?demo=1` を開くと、ログインせずに見本データで画面と操作を確かめられる。
