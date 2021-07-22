"use strict";

const assert = require("assert");

const { encodeReply, decodeReply } = require("../lib/index");
import type { FromTo } from "../lib/index";

const { parse } = require("smtp-address-parser");

const secret = "Not a real secret, of course.";

describe("test encode and decode", function () {
    const testCases: FromTo[] = [
        // Normal cases.
        { mailFrom: "reply@example.com", rcptToLocalPart: "local" },
        { mailFrom: "reply@example.com", rcptToLocalPart: "local-address" },
        { mailFrom: "one.reply@example.com", rcptToLocalPart: "local" },
        { mailFrom: "reply=something@example.com", rcptToLocalPart: "local" },

        // Should work with UTF-8 in all the places.
        { mailFrom: "♥@♥.example.com", rcptToLocalPart: "♥" },

        // These should force blob mode.
        { mailFrom: "reply@example.com", rcptToLocalPart: "separator=in=address" },
        { mailFrom: '"quoted string"@example.com', rcptToLocalPart: "local" },
        { mailFrom: "reply@[127.0.0.1]", rcptToLocalPart: "local" },
        { mailFrom: "reply@[IPv6:::1]", rcptToLocalPart: "local" },
    ];

    it("verify specific encodings", function () {
        const encRep = encodeReply({ mailFrom: "anybody@mailhog.duck", rcptToLocalPart: "mydisabledalias" }, secret);
        assert.equal(encRep, "rep=GHFMH8=mydisabledalias=anybody=mailhog.duck");
        const decRep = decodeReply(encRep, secret);
        assert.equal(decRep.mailFrom, "anybody@mailhog.duck");
        assert.equal(decRep.rcptToLocalPart, "mydisabledalias");

        assert.equal(encodeReply({ mailFrom: "x@y.z", rcptToLocalPart: "a" }, secret), "rep=RHGA7M=a=x=y.z");
    });

    it("verify basic operation", function () {
        testCases.forEach((testCase) => {
            const encRep = encodeReply(testCase, secret);
            // Check that our local-part is valid:
            const a = parse(`${encRep}@x.y`);
            assert.equal(a.localPart.DotString, encRep);
            // Decode what we just encoded:
            const decRep = decodeReply(encRep, secret);
            // Check that it matches what we put in:
            assert.equal(decRep.mailFrom, testCase.mailFrom);
            assert.equal(decRep.rcptToLocalPart, testCase.rcptToLocalPart);
        });
    });

    it("check invalid reply addresses", function () {
        const testCase = { mailFrom: "reply@example.com", rcptToLocalPart: "local" };
        const encRep = encodeReply(testCase, secret);
        // Any change to the reply should break it:
        const encRepPlus = encRep + "x";
        assert.equal(decodeReply(encRepPlus, secret), undefined);
        const encRepBadHash = encRep.substr(0, 4) + "AAAA" + encRep.substr(8);
        assert.equal(decodeReply(encRepBadHash, secret), undefined);
    });

    it("change the secret", function () {
        const testCase = { mailFrom: "reply@example.com", rcptToLocalPart: "local" };
        const encRep = encodeReply(testCase, secret + "not the same");
        assert.equal(decodeReply(encRep, secret), undefined);
    });

    it("rudely map case", function () {
        const testCase = { mailFrom: "reply@example.com", rcptToLocalPart: "local" };
        const encRep = encodeReply(testCase, secret);

        // Many email systems will map case, but we should still deal with it.

        // Check that it matches what we put in, except for the case mapping to upper.
        const decRep = decodeReply(encRep.toUpperCase(), secret);
        assert.equal(decRep.mailFrom, testCase.mailFrom.toUpperCase());
        assert.equal(decRep.rcptToLocalPart, testCase.rcptToLocalPart.toUpperCase());

        // Check that it matches what we put in, except for the case mapping to lower.
        const decRepLower = decodeReply(encRep.toLowerCase(), secret);
        assert.equal(decRepLower.mailFrom, testCase.mailFrom.toLowerCase());
        assert.equal(decRepLower.rcptToLocalPart, testCase.rcptToLocalPart.toLowerCase());
    });
});
