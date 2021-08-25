"use strict";

const crypto = require("crypto");
const smtpAddressParser = require("smtp-address-parser");
const util = require("util");
import { base32Encode, base32Decode } from "@ctrl/ts-base32";

const base32Type = "Crockford"; // <https://www.crockford.com/base32.html>

const hashLengthMin = 6; // 1 in a billion
const hashLengthMax = 10;

const sep = "="; // legcay format
const prefix = `rep${sep}`; // legcay format

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

function decodeBlob(encodedBlob: string, secret: string): FromTo | null {
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
        return null; // Malformed reply address.
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

function tryDecode(addr: string, secret: string, sepChar: string): FromTo | null {
    // {mail_from.local}=at={mail_from.domain}={hash}={rcpt_to_local_part}
    //  or
    // {mail_from.local}={mail_from.domain}={hash}={rcpt_to_local_part}

    const rcpt_to_loc_sep = addr.lastIndexOf(sepChar);
    if (rcpt_to_loc_sep === -1) {
        return null;
    }
    const rcpt_to_loc_pos = rcpt_to_loc_sep + 1;
    const rcpt_to_loc_len = addr.length - rcpt_to_loc_pos;

    const rcpt_loc = addr.substr(rcpt_to_loc_pos, rcpt_to_loc_len);

    const hash_sep = addr.substr(0, rcpt_to_loc_sep).lastIndexOf(sepChar);
    if (hash_sep === -1) {
        return null;
    }
    const hash_pos = hash_sep + 1;
    const hash_len = rcpt_to_loc_sep - hash_pos;
    if (hash_len < hashLengthMin || hash_len > hashLengthMax) {
        return null;
    }
    const hash = addr.substr(hash_pos, hash_len);
    // The hash part must look like a hash
    if (!isPureBase32(hash)) {
        return null;
    }

    const mail_from_dom_sep = addr.substr(0, hash_sep).lastIndexOf(sepChar);
    if (mail_from_dom_sep === -1) {
        return null;
    }

    const mail_from_dom_pos = mail_from_dom_sep + 1;
    const mail_from_dom_len = hash_sep - mail_from_dom_pos;
    const mail_from_dom = addr.substr(mail_from_dom_pos, mail_from_dom_len);

    var mail_from_loc = addr.substr(0, mail_from_dom_sep);

    // Check if the local part ends with _at and remove it.
    if (mail_from_loc.toLowerCase().endsWith(`${sepChar}at`)) {
        mail_from_loc = addr.substr(0, mail_from_dom_sep - 3);
    }

    const mail_from = `${mail_from_loc}@${mail_from_dom}`;

    // The mail_from part must be a valid Mailbox address.
    try {
        smtpAddressParser.parse(mail_from);
    } catch (e) {
        return null;
    }

    const replyInfo = {
        mailFrom: mail_from,
        rcptToLocalPart: rcpt_loc,
    };

    const hashComputed = hashRep(replyInfo, secret);
    if (hash.toLowerCase() != hashComputed) {
        return null;
    }

    return replyInfo;
}

// Legacy format reply address with the REP= prefix. We no longer
// generates these addresses, but we continue to decode them in a
// compatable way.

export function oldDecodeReply(rep: string, secret: string): FromTo | null {
    if (isPureBase32(rep)) {
        return decodeBlob(rep, secret);
    }

    // *** legacy reply address layout ***
    // The prefix (rep=) has been removed, reply address is now:
    // {hash}={rcpt_to_local_part}={mail_from.local}={mail_from.domain}
    //       ^1st                 ^2nd              ^last
    // The mail_from.local can contain separator characters.
    // See the return value from encodeReply() below...

    const sep = "=";

    const firstSep = rep.indexOf(sep);
    const secondSep = rep.substr(firstSep + 1).indexOf(sep) + firstSep + 1;
    const lastSep = rep.lastIndexOf(sep);

    if (firstSep == lastSep || secondSep == lastSep) {
        return null; // Malformed reply address, not enough separators.
    }

    const rcptToPos = firstSep + 1;
    const mfLocPos = secondSep + 1;
    const mfDomPos = lastSep + 1;

    const rcptToLen = secondSep - rcptToPos;
    const mfLocLen = lastSep - mfLocPos;

    const hash = rep.substr(0, firstSep);
    const rcptToLoc = rep.substr(rcptToPos, rcptToLen);
    const mailFromLoc = rep.substr(mfLocPos, mfLocLen);
    const mailFromDom = rep.substr(mfDomPos);

    const replyInfo = {
        mailFrom: `${mailFromLoc}@${mailFromDom}`,
        rcptToLocalPart: rcptToLoc,
    };

    const hashComputed = hashRep(replyInfo, secret);
    if (hash.toLowerCase() != hashComputed) {
        return null; // Malformed reply address.
    }

    return replyInfo;
}

export function decodeReply(localPart: string, secret: string): FromTo | null {
    try {
        // Validate the input local-part
        smtpAddressParser.parse(`${localPart}@x.y`);
    } catch (e) {
        return null;
    }

    // Check for legacy reply format.
    const pfx = localPart.substr(0, prefix.length);
    if (pfx.toLowerCase().startsWith(prefix)) {
        const rep = localPart.substr(prefix.length);
        return oldDecodeReply(rep, secret);
    }

    // What type of reply address do we have?
    if (isPureBase32(localPart)) {
        // If everything is base32 we might have a blob:
        if (localPart.length > 25) {
            return decodeBlob(localPart, secret);
        }
        return null; // Not a reply address.
    }

    for (const sepChar of sepChars) {
        const replyInfo = tryDecode(localPart, secret, sepChar);
        if (replyInfo) return replyInfo;
    }

    return null;
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

    // If the rcptToLocalPart is a quoted-string, fall back to blob encoding.
    if (loc.localPart.QuotedString) {
        return encodeBlob(replyInfo, secret);
    }

    const hash = hashRep(replyInfo, secret);

    for (const sepChar of sepChars) {
        if (!replyInfo.rcptToLocalPart.includes(sepChar)) {
            return `${mailFrom.localPart.DotString}${sepChar}at${sepChar}${mailFrom.domainPart.DomainName}${sepChar}${hash}${sepChar}${replyInfo.rcptToLocalPart}`;
        }
    }

    return encodeBlob(replyInfo, secret);
}
