"use strict";

const crypto = require("crypto");
const smtpAddressParser = require("smtp-address-parser");
const util = require("util");
import { base32Encode, base32Decode } from "@ctrl/ts-base32";

const hashLength = 6;
const base32Type = "Crockford";

export interface FromTo {
    mailFrom: string;
    rcptToLocalPart: string;
}

// The hash has to survive case mapping.
function hashRep(replyInfo: FromTo, secret: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(secret);
    hash.update(replyInfo.mailFrom.toLowerCase());
    hash.update(replyInfo.rcptToLocalPart.toLowerCase());
    return base32Encode(hash.digest(), base32Type).substring(0, hashLength);
}

function decodeBlob(addr: string, secret: string): FromTo | undefined {
    const pktArrayBuffer = base32Decode(addr, base32Type);

    const pkt = new util.TextDecoder("utf-8").decode(pktArrayBuffer);

    const hash = pkt.substr(0, hashLength);

    const parts = pkt.substr(hashLength).split("\x00");

    return { mailFrom: parts[1], rcptToLocalPart: parts[0] };
}

function encodeBlob(replyInfo: FromTo, secret: string): string {
    const hash = hashRep(replyInfo, secret);
    const pkt = `${hash}${replyInfo.rcptToLocalPart}\x00${replyInfo.mailFrom}`;
    return `rep=${base32Encode(Buffer.from(pkt), base32Type)}`;
}

function isPureBase32(s: string): boolean {
    return /^[0-9A-Ha-hJ-Kj-kM-Nm-nP-Tp-tV-Zv-z]+$/.test(s);
}

export function decodeReply(addr: string, secret: string): FromTo | undefined {
    const prefix = addr.substr(0, 4);
    if (!prefix.toLowerCase().startsWith("rep=")) {
        return;
    }
    addr = addr.substr(4);
    if (isPureBase32(addr)) {
        // if everything after rep= is base32 we have a blob
        return decodeBlob(addr, secret);
    }

    // REP= has been removed, addr is now:
    // {hash}={rcpt_to_local_part}={mail_from.local}={mail_from.domain}
    //       ^1st                 ^2nd              ^last
    // and mail_from.local can contain '=' chars

    const firstSep = addr.indexOf("=");
    const lastSep = addr.lastIndexOf("=");
    const secondSep = addr.substr(firstSep + 1).indexOf("=") + firstSep + 1;

    if (firstSep == lastSep || secondSep == lastSep) {
        return;
    }

    const replyHash = addr.substr(0, firstSep);

    const rcptToPos = firstSep + 1;
    const mfLocPos = secondSep + 1;
    const mfDomPos = lastSep + 1;

    const rcptToLen = secondSep - rcptToPos;
    const mfLocLen = lastSep - mfLocPos;

    const rcptToLoc = addr.substr(rcptToPos, rcptToLen);
    const mailFromLoc = addr.substr(mfLocPos, mfLocLen);
    const mailFromDom = addr.substr(mfDomPos);

    const replyInfo = {
        mailFrom: `${mailFromLoc}@${mailFromDom}`,
        rcptToLocalPart: rcptToLoc,
    };
}

export function encodeReply(replyInfo: FromTo, secret: string): string {
    const mailFrom = smtpAddressParser.parse(replyInfo.mailFrom);

    // If mailFrom is "local part"@example.com or local-part@[127.0.0.1] we
    // must fall back to the blob style.
    if (mailFrom.localPart.QuotedString || mailFrom.domainPart.AddressLiteral) {
        return encodeBlob(replyInfo, secret);
    }

    // If rcptToLocalPart contain a '=' fall back.
    if (replyInfo.rcptToLocalPart.includes("=")) {
        return encodeBlob(replyInfo, secret);
    }

    const hash = hashRep(replyInfo, secret);

    return `rep=${hash}=${replyInfo.rcptToLocalPart}=${mailFrom.localPart.DotString}=${mailFrom.domainPart.DomainName}`;
}
