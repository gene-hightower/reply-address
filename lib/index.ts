"use strict";

const crypto = require("crypto");
const smtpAddressParser = require("smtp-address-parser");
const util = require("util");
import { base32Encode, base32Decode } from "@ctrl/ts-base32";

const base32Type = "Crockford"; // <https://www.crockford.com/base32.html>
const hashCharsToInclude = 6; // How many bytes of hash to use.
const sep = "=";
const prefix = `rep${sep}`;
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
    return base32Encode(hash.digest(), base32Type).substring(0, hashCharsToInclude);
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
    if (hash.toUpperCase() != hashComputed) {
        return; // Malformed reply address.
    }

    return replyInfo;
}

function encodeBlob(replyInfo: FromTo, secret: string): string {
    const hash = hashRep(replyInfo, secret);
    const blob = `${hash}${sepBlob}${replyInfo.rcptToLocalPart}${sepBlob}${replyInfo.mailFrom}`;
    return `${prefix}${base32Encode(Buffer.from(blob), base32Type)}`;
}

function isPureBase32(s: string): boolean {
    return /^[0-9A-Ha-hJ-Kj-kM-Nm-nP-Tp-tV-Zv-z]+$/.test(s);
}

export function decodeReply(localPart: string, secret: string): FromTo | undefined {
    // Validate the input local-part
    smtpAddressParser.parse(`${localPart}@x.y`);

    // Check for and remove reply address prefix.
    const pfx = localPart.substr(0, prefix.length);
    if (!pfx.toLowerCase().startsWith(prefix)) {
        return; // Not a reply address.
    }
    const rep = localPart.substr(prefix.length);

    // What type of reply address do we have?
    if (isPureBase32(rep)) {
        // If everything after prefix is base32 we have a blob:
        return decodeBlob(rep, secret);
    }

    // *** reply address layout ***
    // The prefix (rep=) has been removed, reply address is now:
    // {hash}={rcpt_to_local_part}={mail_from.local}={mail_from.domain}
    //       ^1st                 ^2nd              ^last
    // The mail_from.local can contain separator characters.
    // See the return value from encodeReply() below...

    const firstSep = rep.indexOf(sep);
    const secondSep = rep.substr(firstSep + 1).indexOf(sep) + firstSep + 1;
    const lastSep = rep.lastIndexOf(sep);

    if (firstSep == lastSep || secondSep == lastSep) {
        return; // Malformed reply address, not enough separators.
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
    if (hash.toUpperCase() != hashComputed) {
        return; // Malformed reply address.
    }

    return replyInfo;
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

    // If rcptToLocalPart contains a sep fall back to blob encoding.
    if (replyInfo.rcptToLocalPart.includes(sep)) {
        return encodeBlob(replyInfo, secret);
    }

    const hash = hashRep(replyInfo, secret);

    // *** reply address layout ***
    // See the code in decodeReply above.

    return `${prefix}${hash}${sep}${replyInfo.rcptToLocalPart}${sep}${mailFrom.localPart.DotString}${sep}${mailFrom.domainPart.DomainName}`;
}
