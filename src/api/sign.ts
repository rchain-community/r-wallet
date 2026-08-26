// Deploy signing (secp256k1 + blake2b256 over the protobuf-encoded DeployData).
// Includes the `shardId` fix: field 11 must be written into the serialized
// DeployData or the node rejects the deploy with "Deploy signature is invalid.".

import elliptic from "elliptic";
import blake from "blakejs";
import jspb from "google-protobuf";
import type { DeployData, DeployRequest } from "./types";

const encodeBase16 = (bytes: Uint8Array | number[]) =>
    Array.from(bytes).map(x => (x & 0xff).toString(16).padStart(2, "0")).join("");

// DeployDataProto field numbers (models/proto/casper.proto):
//   term = 2, timestamp = 3, phloPrice = 7, phloLimit = 8,
//   validAfterBlockNumber = 10, shardId = 11
export function deployDataProtobufSerialize(deployData: DeployData): Uint8Array {
    const { term, timestamp, phloPrice, phloLimit, validAfterBlockNumber, shardId } = deployData;

    const writer = new jspb.BinaryWriter();
    const writeString = (order: number, val: string) => { if (val !== "") writer.writeString(order, val); };
    const writeInt64 = (order: number, val: number) => { if (val !== 0) writer.writeInt64(order, val); };

    writeString(2, term);
    writeInt64(3, timestamp);
    writeInt64(7, phloPrice);
    writeInt64(8, phloLimit);
    writeInt64(10, validAfterBlockNumber);
    writeString(11, shardId);

    return writer.getResultBuffer();
}

export function signDeploy(deployData: DeployData, privateKey: string): DeployRequest {
    const secp256k1 = new elliptic.ec("secp256k1");
    const key = secp256k1.keyFromPrivate(privateKey.replace(/^0x/, ""));

    const deployer = Uint8Array.from(key.getPublic("array"));
    const hashed = blake.blake2bHex(deployDataProtobufSerialize(deployData), undefined, 32);
    const sig = Uint8Array.from(key.sign(hashed, { canonical: true }).toDER());

    return {
        data: {
            term: deployData.term,
            timestamp: deployData.timestamp,
            phloPrice: deployData.phloPrice,
            phloLimit: deployData.phloLimit,
            validAfterBlockNumber: deployData.validAfterBlockNumber,
            shardId: deployData.shardId,
        },
        deployer: encodeBase16(deployer),
        signature: encodeBase16(sig),
        sigAlgorithm: "secp256k1",
    };
}
