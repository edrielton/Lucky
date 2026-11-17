import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedNodeVersion } from "../src/testing/quality.ts";

test("portão de qualidade aceita Node 22.18 ou superior", () => {
  assert.equal(isSupportedNodeVersion("v22.18.0"), true);
  assert.equal(isSupportedNodeVersion("v22.18.1"), true);
  assert.equal(isSupportedNodeVersion("v22.20.0"), true);
  assert.equal(isSupportedNodeVersion("v23.0.0"), true);
});

test("portão de qualidade rejeita Node abaixo do mínimo e versões inválidas", () => {
  assert.equal(isSupportedNodeVersion("v22.16.0"), false);
  assert.equal(isSupportedNodeVersion("v22.17.99"), false);
  assert.equal(isSupportedNodeVersion("v21.99.99"), false);
  assert.equal(isSupportedNodeVersion("não-é-versão"), false);
});
