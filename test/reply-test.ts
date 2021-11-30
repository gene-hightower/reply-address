"use strict";

const assert = require("assert");

const { encodeReply, decodeReply, encodeBounce, decodeBounce } = require("../lib/index");
import type { FromTo } from "../lib/index";

const { parse } = require("smtp-address-parser");

const secret = "Not a real secret, of course.";

describe("test bounce encode and decode", function () {
    it("working encode and decode", function () {
        assert.equal(decodeBounce(encodeBounce(9, secret), secret), 9);
        assert.equal(decodeBounce(encodeBounce(999999999, secret), secret), 999999999);
    });
    it("test decode failures", function () {
        const enc = encodeBounce(99, secret);

        const res = enc.match(/Bounce0=(\d{1,9})=(\d{5})=([0-9A-HJ-KM-NP-TV-Z]{6})/i);
        assert(res);

        const id = Number(res[1]);
        const day = Number(res[2]);
        const hsh = res[3];

        assert.equal(decodeBounce(`Bounce0=${id}=${day}=${hsh}`, secret), 99);

        // too old
        assert.equal(decodeBounce(`Bounce0=${id}=${day - 9}=${hsh}`, secret), null);
        // different id
        assert.equal(decodeBounce(`Bounce0=${id + 1}=${day}=${hsh}`, secret), null);
        // bad hash
        assert.equal(decodeBounce(`Bounce0=${id}=${day}=abc123`, secret), null);
        // bad syntax
        assert.equal(decodeBounce(`XYZ=${id}=${day}=${hsh}`, secret), null);
    });
});

describe("test reply encode and decode", function () {
    console.log(`${encodeReply({ mailFrom: "random@mailhog.duck", rcptToLocalPart: "duckuser" }, secret)}`);

    const y00 = { mailFrom: "x@y.z", rcptToLocalPart: "a" };
    const x00 = decodeReply("x_at_y.z_a", secret);
    assert.deepStrictEqual(x00, y00);

    const y0 = { mailFrom: "x@y.z", rcptToLocalPart: "a" };
    const x0 = decodeReply("rep=RHGA7M=a=x=y.z", secret);
    assert.deepStrictEqual(x0, y0);

    const y1 = { mailFrom: "x@y.z", rcptToLocalPart: "a=a" };
    const x1 = decodeReply("rep=6NBM8PA4AR062FB101W40Y9EF8", secret);
    assert.deepStrictEqual(x1, y1);

    const z1 = decodeReply("rep=6nbm8pa4ar062fb101w40y9ef8", secret);
    assert.deepStrictEqual(x1, z1);

    assert.deepStrictEqual(encodeReply({ mailFrom: "x@y.z", rcptToLocalPart: "a" }, secret), "x_at_y.z_rhga7m_a");
    assert.deepStrictEqual(encodeReply({ mailFrom: "x_x@y.z", rcptToLocalPart: "a" }, secret), "x_x_at_y.z_4797dj_a");
    assert.deepStrictEqual(encodeReply({ mailFrom: "x=x@y.z", rcptToLocalPart: "a" }, secret), "x=x_at_y.z_a0dt6k_a");
    assert.deepStrictEqual(
        encodeReply({ mailFrom: "x=x@y.z", rcptToLocalPart: "a_a" }, secret),
        "x=x=at=y.z=2a2qpd=a_a"
    );
    assert.deepStrictEqual(encodeReply({ mailFrom: "x.x@y.z", rcptToLocalPart: "a" }, secret), "x.x_at_y.z_9avgdj_a");
    assert.deepStrictEqual(encodeReply({ mailFrom: "x@y.z", rcptToLocalPart: "a=a" }, secret), "x_at_y.z_5wdydv_a=a");
    assert.deepStrictEqual(encodeReply({ mailFrom: "x@y.z", rcptToLocalPart: "a_a" }, secret), "x=at=y.z=3d8qs3=a_a");

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
        assert.equal(encRep, "anybody_at_mailhog.duck_ghfmh8_mydisabledalias");
        const decRep = decodeReply(encRep, secret);
        assert.equal(decRep.mailFrom, "anybody@mailhog.duck");
        assert.equal(decRep.rcptToLocalPart, "mydisabledalias");

        assert.equal(encodeReply({ mailFrom: "x@y.z", rcptToLocalPart: "a" }, secret), "x_at_y.z_rhga7m_a");
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
