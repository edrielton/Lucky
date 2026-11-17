/**
 * Hashes da distribuição oficial Lucky 0.3.0.
 * Atualizar estes valores exige uma nova revisão e um novo pacote de release.
 * Esta lista é um mecanismo de detecção, não uma fronteira criptográfica contra
 * alguém que consiga editar o código-fonte e este manifesto.
 */
export const RELEASE_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "src/security/integrity.ts": "47a68ffc5b2b74819d92ad15a0720a26587e8d8d0bdfdbfe58796a8d28ac3ef5",
  "package.json": "d950451952336762d04fa8a0a4bde24ac240531e515efc966e03b6e72f7dc564",
  "src/kernel/policy.ts": "e38481b7e72ef2f92d4fc98637fb863af9e09cc099da9233849eb6f9c9b052e6",
  "src/kernel/approval.ts": "93a38d88dfa22d302450bfd465ffdf8b67c2c1eaff32b187ee5ec0dec2a93636",
  "src/development/supervised.ts": "8e1276d5121aea80d46a1a9f1cf56197b406eb39d12cbf8a7c811bd104e29b73",
  "src/exec.ts": "b0c70e0784b468db1bbefbe1c28bb80b977c80987c21b0e7aceaa567ed304239",
  "src/agent/loop.ts": "9eaff17894acd0d3e00a8c15c8e1b1f8f2a323cf559581185a671675e29393a8",
  "src/cli.ts": "ae6277713aa8227f071584592447f837ce6e5aeca87590f8e8ee52332acd9e6e",
  "src/bridge/server.ts": "b89fd8b355fd65a4b31a6179596ce2cbb84a82fbf9231ea22514f79dbb2caf66",
  "pc-extension/manifest.json": "2efb4dcff9a5df34e31172cdc2b1c849266eb7837846aded2ab366e9c772fd2b",
  "pc-extension/popup.js": "ab8b85f94237832acc8e3f7d85648ff4800c75728d6a9188648b24dce61ccbe9",
  "src/security/sandbox.ts": "14991cf18fac64402377c1c86a6095c8d01af973ce774bfbb96ccc0286ae30b3",
  "src/memory/learning.ts": "b25eeb14812f4c6eabaaa8e82b0ebeec9a80b209aaf7565bc7a0edc28c62b928",
  "src/store.ts": "fc6d8bfb255950f6ed562a56fe5483fa23c396487a1fd6745207158e1901a34a",
  "src/testing/runner.ts": "964ab246108f72e692c0fb0034c7c517631a0fbb510ae86e2cae1f677f207911",
  "test/learning-sandbox.test.ts": "42c7536a2d2c0d87be2bf1a5b4ebb84bbd895f2bf9dc658fc7aacde6c31a3a54",
  "test/supervised.test.ts": "a9d7d40124fdca952bd5467726b7e4ad1c0357a50d7097bfca35f7810a2e5c3e",
  "src/intelligence/reasoning.ts": "f3ad838b92e781ed9de797895e4872a4d56aa9233943be5d3bcfcf75e53d1ba3",
  "src/intelligence/planning.ts": "b709483f5c9ab109bf00717838367a6e77ecb7aaf027a6b1c9ca07ff1bdd340a",
  "src/intelligence/evolution.ts": "0ea122a58351896f4e01d7cc0dbe89824dca6b22520c50a2cd027c7cd5cb8283",
  "src/intelligence/index.ts": "5d8f96b1347f01401a05d885ca8e708e3df5aba9773451f37fbf5b28551c3ff2",
  "test/intelligence.test.ts": "a87659de13103f4d54b3ebaa03047a2e7d53c3bf30b4db93759a9817765907b1",
});
