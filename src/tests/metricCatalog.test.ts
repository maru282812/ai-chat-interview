import assert from "node:assert/strict";
import { test } from "node:test";
import {
  METRIC_CATALOG,
  defaultMetricDirection,
  metricDirectionLabel,
  metricLabel,
  normalizeMetricCode,
  normalizeMetricDirection
} from "../lib/metricCatalog";

test("metricCatalog: 推奨カタログのコードは正規化しても不変", () => {
  for (const entry of METRIC_CATALOG) {
    assert.equal(normalizeMetricCode(entry.code), entry.code, `catalog code stable: ${entry.code}`);
  }
});

test("normalizeMetricCode: 大文字・記号・空白を安全化する", () => {
  assert.equal(normalizeMetricCode("Satisfaction"), "satisfaction");
  assert.equal(normalizeMetricCode(" NPS-score "), "nps_score");
  assert.equal(normalizeMetricCode("a--b__c"), "a_b_c");
  assert.equal(normalizeMetricCode("nps2"), "nps2");
});

test("normalizeMetricCode: 空・記号のみ・全角のみ・非文字列は null（未設定）", () => {
  assert.equal(normalizeMetricCode(""), null);
  assert.equal(normalizeMetricCode("   "), null);
  assert.equal(normalizeMetricCode("---"), null);
  assert.equal(normalizeMetricCode("再来店 意向"), null); // 非英数のみ→有効文字が残らず未設定
  assert.equal(normalizeMetricCode(null), null);
  assert.equal(normalizeMetricCode(undefined), null);
  assert.equal(normalizeMetricCode(123), null);
});

test("metricLabel: カタログ優先・未知はコード名", () => {
  assert.equal(metricLabel("satisfaction"), "満足度");
  assert.equal(metricLabel("unknown_metric"), "unknown_metric");
});

test("defaultMetricDirection: カタログ既定・未知は neutral", () => {
  assert.equal(defaultMetricDirection("satisfaction"), "higher_is_better");
  assert.equal(defaultMetricDirection("awareness_channel"), "neutral");
  assert.equal(defaultMetricDirection("unknown_metric"), "neutral");
});

test("normalizeMetricDirection: enum のみ許可", () => {
  assert.equal(normalizeMetricDirection("higher_is_better"), "higher_is_better");
  assert.equal(normalizeMetricDirection("lower_is_better"), "lower_is_better");
  assert.equal(normalizeMetricDirection("neutral"), "neutral");
  assert.equal(normalizeMetricDirection("bogus"), null);
  assert.equal(normalizeMetricDirection(""), null);
  assert.equal(normalizeMetricDirection(null), null);
});

test("metricDirectionLabel: 日本語ラベル", () => {
  assert.equal(metricDirectionLabel("higher_is_better"), "高いほど良い");
  assert.equal(metricDirectionLabel("lower_is_better"), "低いほど良い");
  assert.equal(metricDirectionLabel("neutral"), "中立");
});
