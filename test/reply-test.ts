"use strict";

const assert = require("assert");

const { encodeReply, decodeReply } = require("../lib/index");
import type { FromTo } from "../lib/index";

const { parse } = require("smtp-address-parser");

const secret = "Not a real secret, of course.";

const testCases: FromTo[] = [
    {"mailFrom": "reply@example.com", "rcptToLocalPart": "local-address"},
    {"mailFrom": "one.reply@example.com", "rcptToLocalPart": "local"},
    {"mailFrom": "reply@example.com", "rcptToLocalPart": "local"},
    {"mailFrom": "reply=something@example.com", "rcptToLocalPart": "local"},
    // These should force blob mode:
    {"mailFrom": "reply@example.com", "rcptToLocalPart": "local=address"},
    {"mailFrom": '"quoted string"@example.com', "rcptToLocalPart": "local"},
    {"mailFrom": "reply@[127.0.0.1]", "rcptToLocalPart": "local"},
];

describe("test encode and decode", function () {
    it("first set", function () {
        testCases.forEach(testCase => {
            // const address = `${testCase.rcptToLocalPart}@duck.com`;
            const encRep = encodeReply(testCase, secret);
            console.log(encRep);
            const a = parse(`${encRep}@x.y`);
            const decRep = decodeReply(encRep, secret);
            assert.equal(decRep.mailFrom, testCase.mailFrom);
            assert.equal(decRep.rcptToLocalPart, testCase.rcptToLocalPart);
        });
    });
});
