"use strict";

const assert = require("assert");

const { enc } = require("../lib/index.js");
const { parse } = require("smtp-address-parse");

const secret = "Not a real secret, of course.";

describe("good addresses pass", function () {
    it("a test", function () {
        const address = "asdfsdf@duck.com";
        const a = parse(address);
        const s = enc.encodeReply(enc.decodeReply(a, secret), secret);
        assert.equal(a.localPart.DotString, s);
    });
});
