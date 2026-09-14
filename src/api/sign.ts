// Deploy signing (secp256k1 + blake2b256 over the protobuf-encoded DeployData).
// Includes the `shardId` fix: field 11 must be written into the serialized
// DeployData or the node rejects the deploy with "Deploy signature is invalid.".
// Includes RCHIP #39 attachments: field 12 (`repeated bytes`, hex in JSON) is
// part of the signed payload, so tampering with or stripping an attachment fails.

import elliptic from "elliptic";
import blake from "blakejs";
import jspb from "google-protobuf";
import type { DeployData, DeployRequest } from "./types";

const encodeBase16 = (bytes: Uint8Array | number[]) =>
    Array.from(bytes).map(x => (x & 0xff).toString(16).padStart(2, "0")).join("");

// Strict hex decode, mirroring the node's `base16::decode`: reject non-hex
// characters and odd-length input. `0x` prefixes are NOT accepted — the node
// rejects them too, so failing early here gives a clearer error.
export function decodeBase16(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
        throw new Error(`attachment is not valid hex (odd length): ${hex}`);
    }
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error(`attachment is not valid hex: ${hex}`);
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

// DeployDataProto field numbers (models/proto/casper.proto):
//   term = 2, timestamp = 3, phloPrice = 7, phloLimit = 8,
//   validAfterBlockNumber = 10, shardId = 11, attachments = 12
export function deployDataProtobufSerialize(deployData: DeployData): Uint8Array {
    const { term, timestamp, phloPrice, phloLimit, validAfterBlockNumber, shardId, attachments } =
        deployData;

    const writer = new jspb.BinaryWriter();
    const writeString = (order: number, val: string) => { if (val !== "") writer.writeString(order, val); };
    const writeInt64 = (order: number, val: number) => { if (val !== 0) writer.writeInt64(order, val); };

    writeString(2, term);
    writeInt64(3, timestamp);
    writeInt64(7, phloPrice);
    writeInt64(8, phloLimit);
    writeInt64(10, validAfterBlockNumber);
    writeString(11, shardId);

    // `repeated bytes` (wire type 2). Each element is written, including an
    // empty one (which prost encodes as a zero-length field) — only an empty
    // *list* writes nothing, matching proto3's default omission.
    for (const attachment of attachments ?? []) {
        writer.writeBytes(12, decodeBase16(attachment));
    }

    return writer.getResultBuffer();
}

// The deploy data as it goes over the JSON wire: `attachments` is omitted when
// empty, matching the node's `skip_serializing_if` and keeping bytes identical.
function toDeployRequestData(deployData: DeployData): DeployData {
    const { term, timestamp, phloPrice, phloLimit, validAfterBlockNumber, shardId, attachments } =
        deployData;

    const data: DeployData = {
        term,
        timestamp,
        phloPrice,
        phloLimit,
        validAfterBlockNumber,
        shardId,
    };
    if (attachments && attachments.length > 0) {
        data.attachments = attachments;
    }
    return data;
}

export function signDeploy(deployData: DeployData, privateKey: string): DeployRequest {
    const secp256k1 = new elliptic.ec("secp256k1");
    const key = secp256k1.keyFromPrivate(privateKey.replace(/^0x/, ""));

    const deployer = Uint8Array.from(key.getPublic("array"));
    const hashed = blake.blake2bHex(deployDataProtobufSerialize(deployData), undefined, 32);
    const sig = Uint8Array.from(key.sign(hashed, { canonical: true }).toDER());

    return {
        data: toDeployRequestData(deployData),
        deployer: encodeBase16(deployer),
        signature: encodeBase16(sig),
        sigAlgorithm: "secp256k1",
    };
}
