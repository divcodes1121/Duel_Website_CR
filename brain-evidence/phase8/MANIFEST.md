# Brain evidence - Phase 8b / 8c (integrity manifest)

**This file is tracked. Everything else in this directory is gitignored and must stay that way.**

> **The evidence files contain REAL CLASH ROYALE PLAYER TAGS** (sampled and tracked players, battle
> histories, opponents). The repository is public. They are deliberately excluded by `.gitignore`
> (`/brain-evidence/phase8/*`, re-including only this manifest) and must never be committed, pushed,
> copied into `server/` (which is `scp`'d to the VPS) or published anywhere.

| | |
|---|---|
| preserved | 2026-09-15, Brain Phase 12 |
| expected location | `brain-evidence/phase8/p8b/` and `brain-evidence/phase8/p8c/` (repository root, local only) |
| source location | the Phase 8b/8c session scratchpad, `%TEMP%\claude\c--Users-singh-OneDrive-Desktop-Royal-website\fcee4081-d0df-4310-840a-a320a9e6248b\scratchpad\{p8b,p8c}\` |
| method | `cp -rp` (bytes and modification times preserved); SHA-256, MD5, sizes and mtimes of all 34 files compared source vs copy: identical |
| files / bytes | 34 files, 132,283,959 bytes |
| produced by | Brain Phase 8b (read-only VPS extraction 2026-09-14, production-order replay) and Phase 8c (real `predictor.predict` under both stamps) |
| used by | Brain Phase 10 (independent recomputation of the 8b gate and 8c rule) and Phase 11 (offline equivalence of the implemented fix: 357,426 reads, 128,816 condition-B records, 0 mismatches) |
| why it cannot be regenerated | arrival times (`battle_raw.stored_at`) for this window are destroyed by the raw purge at every bot restart (README KNOWN BUGS #18); the extract is the only copy |
| not preserved here | the Phase 10 (`p10/`) and Phase 11 (`p11/`) verification scripts, which remain in their temporary session scratchpads |

## Files

| file | bytes | modified (local) | SHA-256 | MD5 | role |
|---|---:|---|---|---|---|
| `p8b/PREREGISTRATION.md` | 7,229 | 2026-09-14T13:09:17 | `4b6c28392e5dcbd2d82dfdcab1faf238173e464a37a328576cb29298318c89ae` | `295b88d8db37f2973f9939ff46057e59` |  |
| `p8b/alts_full.out` | 675 | 2026-09-14T13:31:14 | `2ae9e86dbe55d17959eaa014dd5846517f22b0d1acc80ce2c1daef33dc9e6c70` | `0dcc39049d56428e2a94a33a72064034` |  |
| `p8b/analyze.out` | 11,368 | 2026-09-14T13:27:08 | `1b319e4f48ff564a3bab63d23830bbeebdf9ef77f0e1c4adcd8a5a225125bfda` | `ae1aad9e457a51e1a07e3a44f1e4424c` |  |
| `p8b/bot_health.json` | 13,457 | 2026-09-14T12:54:40 | `a8fbd28b9a2e1e5a541039452d1b31d0eafff125693ab887f30351eabaa761b1` | `b12bea9dd1daf73031b3b6fbba6b2dbb` | bot poll health rows (287) |
| `p8b/extract.log` | 1,012 | 2026-09-14T13:01:07 | `8071c1d9ebb29a450256439bdf40917182c0b5e55bf1b7bb7ecfcdeebb9148c6` | `e2f859e1d4f6857bd0458abdee1138cc` |  |
| `p8b/histories.jsonl.gz` | 8,887,373 | 2026-09-14T13:00:39 | `c97c68d433a5dced048c81ca033b1b2ced29761cb8f7c2f6359dfba5b31f1740` | `2112d741a34ed31974e1383bd443dd18` | stored battle histories, one line per sampled player (1,200 lines) - rebuilds each read's information set |
| `p8b/p8b_alts_full.json` | 557 | 2026-09-14T13:31:14 | `322b8a38f701bb4f1b52123ac5bb336a6cb17f410ba52c29dfe603b510ad8aae` | `d20cf05b98b6e9afc632607358264b16` |  |
| `p8b/p8b_alts_full.py` | 4,888 | 2026-09-14T13:30:08 | `ab5e720235e9e854040233ef0843187a396655a0ead764d17403380a683a63d1` | `0c32f76711c9cde874a65f2547dabe6f` |  |
| `p8b/p8b_analyze.py` | 14,425 | 2026-09-14T13:10:49 | `2878a60c5052d487217b1018155d5c51e0e6deab04e75dff8d3bafcbfe06b1cc` | `41f491ccc39e53996a16f2d10622c4eb` |  |
| `p8b/p8b_analyze_log.txt` | 11,355 | 2026-09-14T13:27:08 | `7fc74eb90aa24cab83f8b89145883acad122bee87564f6b29795ad03704b06c8` | `3b98d20229b5228a72913b4b31c79155` |  |
| `p8b/p8b_predict_check.json` | 1,566 | 2026-09-14T13:28:38 | `fa028ce4361a4f03a1a267a500569b465ab3c0456e146a23fc7d564936371447` | `41f41f0d10132436b26ebf3b7e28ea4a` | real `predictor.predict` check under both stamps, 4,500 reads (3,000 competitive + 1,500 practice) |
| `p8b/p8b_predict_check.py` | 5,563 | 2026-09-14T13:13:06 | `f3e1f2ce9b2ddd3ae36d838f10241e0c807e53e9efc223ddb8c66280cd64989e` | `04a955af956628ea0101b47897b28267` |  |
| `p8b/p8b_replay.py` | 12,870 | 2026-09-14T13:08:33 | `1133f2c0ed2c9fbf52d91edf23395700239cc4f0d2855a6eb4ca369ded98aa13` | `977cbcd8ced3ff1101e5d4e85e4acfca` |  |
| `p8b/p8b_results.json` | 127,796 | 2026-09-14T13:27:08 | `68c22531daf94f305fb6c4bd667ce4dcadb5b2c4605d786bea9d908b008eed2c` | `33f184490ff5c5f7de83221d90b4e13d` | Phase 8b gate, metrics, buckets (verdict PASS) |
| `p8b/p8b_sensitivity.json` | 2,081 | 2026-09-14T13:31:21 | `6b42602739620e383f54b3e079819d15aa8e0b2cc8784e30283b7eabc36e712f` | `61425a2748ef04a664c59eed24948ccd` |  |
| `p8b/p8b_sensitivity.py` | 2,398 | 2026-09-14T13:30:48 | `78c0fa5a90ab9951f2d5fc09709407990893eb33b2e01ec359f7c7da36889599` | `f025072caad53a69119aa0b9991bb1cf` |  |
| `p8b/p8b_timing.json` | 5,036 | 2026-09-14T13:03:48 | `7fea0e32a20805fcb3f693b28cc12387531797f23539b1dfe6f9ded8fea0d7ae` | `982c24927eba1b078bf525d19c92002b` |  |
| `p8b/p8b_timing.py` | 4,781 | 2026-09-14T13:01:42 | `bdb04327f437da599e9f2df9fc83295f89f6dd27be8447f37e44f5bbe77fccb1` | `3571cf9ae9b4a364290aa9377bbb980e` |  |
| `p8b/predict_check.out` | 1,578 | 2026-09-14T13:28:38 | `11b140988f571feee2bc9fe39f18dfcdf65b7996d77beaae56f0ab0f2ca38c2f` | `bb3f8db97dbf074c3895d25d20a4adfc` |  |
| `p8b/raw_arrivals.jsonl.gz` | 8,587,838 | 2026-09-14T13:00:24 | `8317b7474bbdc910ba0aa798785427022367850fd45f4ebfac306bacd7f48dc3` | `33b65e5f726bd0f8bcdfbf542677553d` | 1,546,570 `battle_raw` arrival rows (`stored_at`) - arrival visibility |
| `p8b/reads.pkl` | 70,099,126 | 2026-09-14T13:11:59 | `031d7f03e7d339f16b7144daaa949263e02196714662ab6681c887b65837963c` | `9c811181fa5b46c7ec20d3f880a4a4b0` | 357,426 production-order reads (P(change) under 9999 and the request stamp, labels) - the equivalence reference for pB |
| `p8b/replay.out` | 1,911 | 2026-09-14T13:11:59 | `d0887d628347830603d7f39329e0c504819d0d3d65ba88dff8fee3d1c9aabf8f` | `462dd42ec37193a0101650b77f41ecee` |  |
| `p8b/sample.json` | 16,519 | 2026-09-14T13:00:48 | `e00931e26a26a5987995d24f42951345544720f06f82788bb7b7afdcaee697e9` | `be187b69d0b37b7d84ab86669900a666` | the seeded 1,200-player sample (**real tags**) |
| `p8b/tracked.json` | 275,384 | 2026-09-14T13:01:01 | `8b59c6e5fe22b67cceaef980eeea10ed90d026ba1f8d2a3238b5fcd4abf3dbf7` | `f1fe38764a2a37649f741bf53912f190` | `tracked_players` at extraction, 5,319 entries (**real tags**) |
| `p8b/vps_extract.py` | 3,332 | 2026-09-14T12:50:27 | `aa5f5ac767080184b8e66bac5991c5154bfb34ad4dd075df0450883c9d12e275` | `422dfbfa82e02b10a1348a077edce1ea` |  |
| `p8c/PREREGISTRATION.md` | 5,215 | 2026-09-14T13:48:59 | `7fb0ae6019da7740de3edfdc7ccf7d93804fa37148e8afb3a97e6d929bb0ee01` | `2d1720165fb8cc67f7a1365842e3f1e3` |  |
| `p8c/alts.out` | 302 | 2026-09-14T14:04:50 | `51e28c8c282eec6177804b9d5ce981bdaf9e32fa17a946e472eeead7ce60c52e` | `9338f8f6ac63741f9e9d57208b2f3777` |  |
| `p8c/alts.pkl` | 44,091,920 | 2026-09-14T14:04:50 | `b5e2321d71d1a6849fa2d0d36d0beb077a73ebc377d72fd7cd28131ed2e49162` | `3314d0495d3e0bc1c9cb29da00e6297b` | 128,816 condition A/B records from the real predictor (identity/order identical on all 128,816) - the equivalence reference for condition B |
| `p8c/analyze.out` | 11,235 | 2026-09-14T14:05:11 | `83593146b6ae1184763812702cf8a92128cb80aaa6710c02b08f092ec8dd8847` | `7e6f6bfbee2775f7ed32072f445d8c0e` |  |
| `p8c/p8c_alts.py` | 5,549 | 2026-09-14T13:49:45 | `59e754ece5b0c3b832dadc5b3fe363bd8748231e8c2311db513c3f72f1bac088` | `17fc4b9e463d3c2a322e8a011b38fa03` |  |
| `p8c/p8c_analyze.py` | 15,458 | 2026-09-14T13:51:24 | `6470e483fb1bf682a5544ade59756c4b1254d7d41342904c41765db47e0534d0` | `cbacc924c249c3a74345294c9ff47de5` |  |
| `p8c/p8c_log.txt` | 11,223 | 2026-09-14T14:05:11 | `89ee4d9b842a6bd0a9150dea0a6ad94896e6bf6b4dbe7f4452694213e8b8ae94` | `fcb9360f4cce593b33c08f3dc7bc542d` |  |
| `p8c/p8c_results.json` | 34,894 | 2026-09-14T14:05:11 | `c82b27e4aa6d1b9cd4d09c88319ec551730ceb3c950fb823d79322943ed102a2` | `01be072dcba559c8021adfcc49358e4e` | Phase 8c decision rule and decomposition (verdict CONDITIONAL) |
| `p8c/readme_edit1.py` | 8,045 | 2026-09-14T14:11:45 | `01f174238a186493855500cc8075c3c21685573c262d6b9c27b4c2420ebe7de6` | `63368614f89c7acfeb05d5004418ce73` |  |

## Verify

From `brain-evidence/phase8/`, save the block below as a file and run `sha256sum -c <file>`; every line must print `OK`.

```
4b6c28392e5dcbd2d82dfdcab1faf238173e464a37a328576cb29298318c89ae  p8b/PREREGISTRATION.md
2ae9e86dbe55d17959eaa014dd5846517f22b0d1acc80ce2c1daef33dc9e6c70  p8b/alts_full.out
1b319e4f48ff564a3bab63d23830bbeebdf9ef77f0e1c4adcd8a5a225125bfda  p8b/analyze.out
a8fbd28b9a2e1e5a541039452d1b31d0eafff125693ab887f30351eabaa761b1  p8b/bot_health.json
8071c1d9ebb29a450256439bdf40917182c0b5e55bf1b7bb7ecfcdeebb9148c6  p8b/extract.log
c97c68d433a5dced048c81ca033b1b2ced29761cb8f7c2f6359dfba5b31f1740  p8b/histories.jsonl.gz
322b8a38f701bb4f1b52123ac5bb336a6cb17f410ba52c29dfe603b510ad8aae  p8b/p8b_alts_full.json
ab5e720235e9e854040233ef0843187a396655a0ead764d17403380a683a63d1  p8b/p8b_alts_full.py
2878a60c5052d487217b1018155d5c51e0e6deab04e75dff8d3bafcbfe06b1cc  p8b/p8b_analyze.py
7fc74eb90aa24cab83f8b89145883acad122bee87564f6b29795ad03704b06c8  p8b/p8b_analyze_log.txt
fa028ce4361a4f03a1a267a500569b465ab3c0456e146a23fc7d564936371447  p8b/p8b_predict_check.json
f3e1f2ce9b2ddd3ae36d838f10241e0c807e53e9efc223ddb8c66280cd64989e  p8b/p8b_predict_check.py
1133f2c0ed2c9fbf52d91edf23395700239cc4f0d2855a6eb4ca369ded98aa13  p8b/p8b_replay.py
68c22531daf94f305fb6c4bd667ce4dcadb5b2c4605d786bea9d908b008eed2c  p8b/p8b_results.json
6b42602739620e383f54b3e079819d15aa8e0b2cc8784e30283b7eabc36e712f  p8b/p8b_sensitivity.json
78c0fa5a90ab9951f2d5fc09709407990893eb33b2e01ec359f7c7da36889599  p8b/p8b_sensitivity.py
7fea0e32a20805fcb3f693b28cc12387531797f23539b1dfe6f9ded8fea0d7ae  p8b/p8b_timing.json
bdb04327f437da599e9f2df9fc83295f89f6dd27be8447f37e44f5bbe77fccb1  p8b/p8b_timing.py
11b140988f571feee2bc9fe39f18dfcdf65b7996d77beaae56f0ab0f2ca38c2f  p8b/predict_check.out
8317b7474bbdc910ba0aa798785427022367850fd45f4ebfac306bacd7f48dc3  p8b/raw_arrivals.jsonl.gz
031d7f03e7d339f16b7144daaa949263e02196714662ab6681c887b65837963c  p8b/reads.pkl
d0887d628347830603d7f39329e0c504819d0d3d65ba88dff8fee3d1c9aabf8f  p8b/replay.out
e00931e26a26a5987995d24f42951345544720f06f82788bb7b7afdcaee697e9  p8b/sample.json
8b59c6e5fe22b67cceaef980eeea10ed90d026ba1f8d2a3238b5fcd4abf3dbf7  p8b/tracked.json
aa5f5ac767080184b8e66bac5991c5154bfb34ad4dd075df0450883c9d12e275  p8b/vps_extract.py
7fb0ae6019da7740de3edfdc7ccf7d93804fa37148e8afb3a97e6d929bb0ee01  p8c/PREREGISTRATION.md
51e28c8c282eec6177804b9d5ce981bdaf9e32fa17a946e472eeead7ce60c52e  p8c/alts.out
b5e2321d71d1a6849fa2d0d36d0beb077a73ebc377d72fd7cd28131ed2e49162  p8c/alts.pkl
83593146b6ae1184763812702cf8a92128cb80aaa6710c02b08f092ec8dd8847  p8c/analyze.out
59e754ece5b0c3b832dadc5b3fe363bd8748231e8c2311db513c3f72f1bac088  p8c/p8c_alts.py
6470e483fb1bf682a5544ade59756c4b1254d7d41342904c41765db47e0534d0  p8c/p8c_analyze.py
89ee4d9b842a6bd0a9150dea0a6ad94896e6bf6b4dbe7f4452694213e8b8ae94  p8c/p8c_log.txt
c82b27e4aa6d1b9cd4d09c88319ec551730ceb3c950fb823d79322943ed102a2  p8c/p8c_results.json
01f174238a186493855500cc8075c3c21685573c262d6b9c27b4c2420ebe7de6  p8c/readme_edit1.py
```

If any file is missing or differs, the offline equivalence of Phase 11 **cannot** be re-run against it,
and no substitute may be regenerated: record the loss instead.
