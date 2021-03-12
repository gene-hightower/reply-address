const smtpAddressParser = require('smtp-address-parser');

export interface FromTo {
    mailFrom: string;
    rcptTo: string;
}

function decodeNice(replyInfo: FromTo, secret: string): string {
    // parse addr

    return {} as FromTo;
}

function encodeNice(replyInfo: FromTo, secret: string): string {
    return "some string";
}

function decodeBlob(replyInfo: FromTo, secret: string): string {
    // parse addr

    return {} as FromTo;
}

function encodeBlob(replyInfo: FromTo, secret: string): string {
    return "some string";
}

export function decodeReply(addr: string, secret: string): FromTo {
    // parse addr

    return {} as FromTo;
}

export function encodeReply(replyInfo: FromTo, secret: string): string {
    const mailFrom = smtpAddressParser(replyInfo.mailFrom);

    if (replyInfo.rcptTo.includes('=')) {
        throw new Error(`local part '${replyInfo.rcptTo}' must not contain '='`);
    }
    return "some string";
}
