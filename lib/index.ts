"use strict";

const crypto = require("crypto");
const smtpAddressParser = require("smtp-address-parser");
const util = require("util");
import { base32Encode, base32Decode } from "@ctrl/ts-base32";

const base32Type = "Crockford"; // <https://www.crockford.com/base32.html>

const hashLengthMin = 6; // 1 in a billion
const hashLengthMax = 10;

const sepChars = "_=";

const sepBlob = "\x00";

export interface FromTo {
    rcptToLocalPart: string;
    mailFrom: string;
}

// The hash has to survive case mapping, so we lower case the inputs.
function hashRep(replyInfo: FromTo, secret: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(secret);
    hash.update(replyInfo.mailFrom.toLowerCase());
    hash.update(replyInfo.rcptToLocalPart.toLowerCase());
    return base32Encode(hash.digest(), base32Type).substring(0, hashLengthMin).toLowerCase();
}

function decodeBlob(encodedBlob: string, secret: string): FromTo | undefined {
    // Decode the blob:
    const blobArrayBuffer = base32Decode(encodedBlob, base32Type);
    const blob = new util.TextDecoder("utf-8").decode(blobArrayBuffer);

    // Chop it up, extract the parts:
    const parts = blob.split(sepBlob);

    const hash = parts[0];
    const replyInfo = {
        rcptToLocalPart: parts[1],
        mailFrom: parts[2],
    };

    // Check the hash:
    const hashComputed = hashRep(replyInfo, secret);
    if (hash.toLowerCase() != hashComputed) {
        return; // Malformed reply address.
    }

    return replyInfo;
}

function encodeBlob(replyInfo: FromTo, secret: string): string {
    const hash = hashRep(replyInfo, secret);
    const blob = `${hash}${sepBlob}${replyInfo.rcptToLocalPart}${sepBlob}${replyInfo.mailFrom}`;
    return `${base32Encode(Buffer.from(blob), base32Type).toLowerCase()}`;
}

function isPureBase32(s: string): boolean {
    return /^[0-9A-Ha-hJ-Kj-kM-Nm-nP-Tp-tV-Zv-z]+$/.test(s);
}

function tryDecode(addr: string, secret: string, sepChar: string): FromTo | undefined {
    // {mail_from.local}={mail_from.domain}={rcpt_to_local_part}={hash}

    const hash_sep = addr.lastIndexOf(sepChar);
    if (hash_sep === -1) return;
    const hash_pos = hash_sep + 1;
    const hash_len = addr.length - hash_pos;
    if (hash_len < hashLengthMin || hash_len > hashLengthMax) return;

    const hash = addr.substr(hash_pos, hash_len);

    // The hash part must look like a hash
    if (!isPureBase32(hash)) return;

    const rcpt_loc_sep = addr.substr(0, hash_sep).lastIndexOf(sepChar);
    if (rcpt_loc_sep === -1) return;
    const rcpt_loc_pos = rcpt_loc_sep + 1;
    const rcpt_loc_len = hash_sep - rcpt_loc_pos;
    const rcpt_loc = addr.substr(rcpt_loc_pos, rcpt_loc_len);

    const mail_from_dom_sep = addr.substr(0, rcpt_loc_sep).lastIndexOf(sepChar);
    if (mail_from_dom_sep === -1) return;
    const mail_from_dom_pos = mail_from_dom_sep + 1;
    const mail_from_dom_len = rcpt_loc_sep - mail_from_dom_pos;
    const mail_from_dom = addr.substr(mail_from_dom_pos, mail_from_dom_len);

    const mail_from_loc = addr.substr(0, mail_from_dom_sep);
    const mail_from = `${mail_from_loc}@${mail_from_dom}`;

    // The mail_from part must be a valid Mailbox address.
    try {
        smtpAddressParser.parse(mail_from);
    } catch (e) {
        return;
    }

    const replyInfo = {
        mailFrom: mail_from,
        rcptToLocalPart: rcpt_loc,
    };

    const hashComputed = hashRep(replyInfo, secret);
    if (hash.toLowerCase() != hashComputed) {
        return;
    }

    return replyInfo;
}

export function decodeReply(localPart: string, secret: string): FromTo | undefined {
    try {
        // Validate the input local-part
        smtpAddressParser.parse(`${localPart}@x.y`);
    } catch (e) {
        return;
    }

    // What type of reply address do we have?
    if (isPureBase32(localPart)) {
        // If everything is base32 we might have a blob:
        if (localPart.length > 25) {
            return decodeBlob(localPart, secret);
        }
        return; // Not a reply address.
    }

    for (const sepChar of sepChars) {
        const replyInfo = tryDecode(localPart, secret, sepChar);
        if (replyInfo) return replyInfo;
    }

    return;
}

export function encodeReply(replyInfo: FromTo, secret: string): string {
    const mailFrom = smtpAddressParser.parse(replyInfo.mailFrom);

    // If mailFrom is "local part"@example.com or local-part@[127.0.0.1] we
    // must fall back to the blob style.
    if (mailFrom.localPart.QuotedString || mailFrom.domainPart.AddressLiteral) {
        return encodeBlob(replyInfo, secret);
    }

    // Validate the syntax of replyInfo.rcptToLocalPart
    const loc = smtpAddressParser.parse(`${replyInfo.rcptToLocalPart}@x.y`);

    // If the rcptToLocalPart is a quoted-string, fall back to blob encoding.
    if (loc.localPart.QuotedString) {
        return encodeBlob(replyInfo, secret);
    }

    const hash = hashRep(replyInfo, secret);

    for (const sepChar of sepChars) {
        if (!replyInfo.rcptToLocalPart.includes(sepChar)) {
            return `${mailFrom.localPart.DotString}${sepChar}${mailFrom.domainPart.DomainName}${sepChar}${replyInfo.rcptToLocalPart}${sepChar}${hash}`;
        }
    }

    return encodeBlob(replyInfo, secret);
}
