import assert from "node:assert/strict";
import test from "node:test";

import { project } from "../skills/jmespath.mjs";

const fixture = {
  issues: [
    { key: "HEC-1", fields: { summary: "A", status: { name: "Open" } } },
    { key: "HEC-2", fields: { summary: "B", status: { name: "Done" } } },
    { key: "HEC-3", fields: { status: { name: "Open" } } },
  ],
  results: [{ content: { title: "T1" } }],
  title: "Page",
  body: { storage: { value: "<p>x</p>" } },
  text: "abc",
  count: 3,
  empty: [],
  nothing: null,
  obj: { length: "field-value" },
};

test("documented projections return the expected records", () => {
  assert.deepEqual(
    project(fixture, "issues[*].{key: key, summary: fields.summary, status: fields.status.name}"),
    [
      { key: "HEC-1", summary: "A", status: "Open" },
      { key: "HEC-2", summary: "B", status: "Done" },
      { key: "HEC-3", summary: null, status: "Open" },
    ],
  );
  assert.deepEqual(
    project(fixture, "issues[*].{key: key, summary: fields.summary}"),
    [
      { key: "HEC-1", summary: "A" },
      { key: "HEC-2", summary: "B" },
      { key: "HEC-3", summary: null },
    ],
  );
  assert.deepEqual(project(fixture, "body.storage.value"), "<p>x</p>");
  assert.deepEqual(project(fixture, "results[*].content.title"), ["T1"]);
});

test("paths, indexes and identity", () => {
  assert.equal(project(fixture, "title"), "Page");
  assert.equal(project(fixture, "fields.summary"), null);
  assert.equal(project(fixture, "issues[0].key"), "HEC-1");
  assert.equal(project(fixture, "issues[-1].key"), "HEC-3");
  assert.equal(project(fixture, "issues[9].key"), null);
  assert.equal(project(fixture, "missing.deep.path"), null);
  assert.deepEqual(project(fixture, "@"), fixture);
  assert.deepEqual(project(fixture, undefined), fixture);
});

test("splats flatten one level and omit null results", () => {
  assert.deepEqual(project(fixture, "issues[*].fields.summary"), ["A", "B"]);
  assert.deepEqual(project(fixture, "issues[*].fields.status.name"), [
    "Open",
    "Done",
    "Open",
  ]);
  assert.deepEqual(project(fixture, "issues[*].missing"), []);
  assert.deepEqual(project(fixture, "empty[*].key"), []);
  assert.equal(project(fixture, "title[*].key"), null);
});

test("hashes read fields, including one named length", () => {
  assert.deepEqual(project(fixture, "obj.{l: length}"), { l: "field-value" });
  assert.deepEqual(project(fixture, "issues[0].fields.{s: summary}"), { s: "A" });
  assert.deepEqual(project(fixture, "results[0].content.{t: title}"), { t: "T1" });
});

test("length() counts arrays and strings only", () => {
  assert.equal(project(fixture, "length(issues)"), 3);
  assert.equal(project(fixture, "length(text)"), 3);
  assert.equal(project(fixture, "length(empty)"), 0);
  assert.equal(project(fixture, "length(count)"), null);
  assert.equal(project(fixture, "length"), null);
});

test("pipe feeds the left result into the right", () => {
  assert.equal(project(fixture, "issues[*].key | [0]"), "HEC-1");
  assert.equal(project(fixture, "issues[*].{k: key} | [0].k"), "HEC-1");
  assert.equal(project(fixture, "length(issues[*].key)"), 3);
});

test("field access never leaks array builtins", () => {
  assert.equal(project(fixture, "issues.length"), null);
  assert.deepEqual(project(fixture, "issues[*].key.length"), []);
});

test("unsupported syntax fails loudly instead of returning wrong data", () => {
  const rejected = [
    "issues[*][0]", // index after a splat
    "issues[*].fields[0]",
    "a[?b == 'c']", // filters
    "foo(issues)", // unknown function
    "a..b",
    "a.b.",
    "{a}", // hash entry without a value
    "issues[*].{k}",
  ];
  for (const expression of rejected) {
    assert.throws(
      () => project(fixture, expression),
      /Invalid projection|Unsupported/,
      `expected ${JSON.stringify(expression)} to be rejected`,
    );
  }
});
