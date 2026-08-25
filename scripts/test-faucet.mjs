import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ec } = require('elliptic');
const { blake2bHex } = require('blakejs');
const jspb = require('google-protobuf');
const { keccak256 } = require('js-sha3');
const bs58 = require('bs58');

const HTTP = 'http://localhost:40403';
const ADMIN = 'http://localhost:40405';
const DEPLOYER_PRIV = 'a68a6e6cca30f81bd24a719f3145d20e8424bd7b396309b0708a16c7d8000b76';
const KNOWN_DEPLOYER_ADDR = '11112VYAt8rUGNRRZX3eJdgagaAhtWTK8Js7F7X5iqddMVqyDTtYau';

// ---- hex helpers ----
const encodeBase16 = (bytes) => Array.from(bytes).map(x => (x & 0xff).toString(16).padStart(2, '0')).join('');
const decodeBase16 = (hex) => {
  const s = hex.replace(/^0x/, '');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};

// ---- address derivation (mirrors src/utils/blockchain.ts) ----
function getAddrFromPrivateKey(privKey) {
  const key = new ec('secp256k1').keyFromPrivate(privKey);
  const pubBytes = decodeBase16(key.getPublic('hex')); // 64 bytes
  const pkHash = keccak256(pubBytes.slice(1)); // drop 0x04 prefix byte
  const ethAddr = pkHash.slice(-40); // 20 bytes
  const ethHash = keccak256(decodeBase16(ethAddr));
  const payloadHex = '00000000' + ethHash; // coinId(000000) + version(00) + ethHash
  const payloadBytes = decodeBase16(payloadHex);
  const checksum = blake2bHex(payloadBytes, undefined, 32).slice(0, 8);
  return bs58.encode(decodeBase16(payloadHex + checksum));
}

// ---- deploy signing (mirrors src/api/sign.ts, incl. shardId field 11) ----
function deployDataProtobufSerialize(dd) {
  const w = new jspb.BinaryWriter();
  const ws = (o, v) => { if (v !== '') w.writeString(o, v); };
  const wi = (o, v) => { if (v !== 0) w.writeInt64(o, v); };
  ws(2, dd.term); wi(3, dd.timestamp); wi(7, dd.phloPrice); wi(8, dd.phloLimit);
  wi(10, dd.validAfterBlockNumber); ws(11, dd.shardId);
  return w.getResultBuffer();
}

function signDeploy(deployData, privKey) {
  const key = new ec('secp256k1').keyFromPrivate(privKey);
  const deployer = Uint8Array.from(key.getPublic('array'));
  const hashed = blake2bHex(deployDataProtobufSerialize(deployData), undefined, 32);
  const sig = Uint8Array.from(key.sign(hashed, { canonical: true }).toDER());
  return {
    data: { ...deployData },
    deployer: encodeBase16(deployer),
    signature: encodeBase16(sig),
    sigAlgorithm: 'secp256k1',
  };
}

// ---- rholang (mirrors src/utils/rho.ts) ----
const fn_transfer_funds = (from, to, amount) => `
  new rl(\`rho:registry:lookup\`), RevVaultCh in {
    rl!(\`rho:rchain:revVault\`, *RevVaultCh) |
    for (@(_, RevVault) <- RevVaultCh) {
      new vaultCh, vaultTo, revVaultkeyCh,
      deployerId(\`rho:rchain:deployerId\`),
      deployId(\`rho:rchain:deployId\`)
      in {
        match ("${from}", "${to}", ${amount}) {
          (revAddrFrom, revAddrTo, amount) => {
            @RevVault!("findOrCreate", revAddrFrom, *vaultCh) |
            @RevVault!("findOrCreate", revAddrTo, *vaultTo) |
            @RevVault!("deployerAuthKey", *deployerId, *revVaultkeyCh) |
            for (@vault <- vaultCh; key <- revVaultkeyCh; _ <- vaultTo) {
              match vault {
                (true, vault) => {
                  new resultCh in {
                    @vault!("transfer", revAddrTo, amount, *key, *resultCh) |
                    for (@result <- resultCh) {
                      match result {
                        (true , _  ) => deployId!((true, "Transfer successful (not yet finalized)."))
                        (false, err) => deployId!((false, err))
                      }
                    }
                  }
                }
                err => { deployId!((false, "Vault cannot be found or created.")) }
              }
            }
          }
        }
      }
    }
  }
`;

const fn_check_balance = (rev_addr) => `
  new return, rl(\`rho:registry:lookup\`), RevVaultCh, vaultCh, balanceCh in {
    rl!(\`rho:rchain:revVault\`, *RevVaultCh) |
    for (@(_, RevVault) <- RevVaultCh) {
      @RevVault!("findOrCreate", "${rev_addr}", *vaultCh) |
      for (@(true, vault) <- vaultCh) {
        @vault!("balance", *balanceCh) |
        for (@balance <- balanceCh) { return!(balance) }
      }
    }
  }
`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const targetPriv = new ec('secp256k1').genKeyPair().getPrivate('hex');
  const targetAddr = getAddrFromPrivateKey(targetPriv);
  const deployerAddr = getAddrFromPrivateKey(DEPLOYER_PRIV);

  console.log('deployer addr (derived):', deployerAddr);
  console.log('deployer addr matches  :', deployerAddr === KNOWN_DEPLOYER_ADDR);
  console.log('target addr (fresh)    :', targetAddr);

  const status = await (await fetch(`${HTTP}/api/status`)).json();
  console.log('status:', JSON.stringify({ shardId: status.shardId, minPhloPrice: status.minPhloPrice, latestBlockNumber: status.latestBlockNumber }));

  const amount = 1000 * 100000000; // 1000 REV
  const deployData = {
    term: fn_transfer_funds(deployerAddr, targetAddr, amount),
    timestamp: Date.now(),
    phloPrice: Math.max(1, status.minPhloPrice),
    phloLimit: 500000,
    validAfterBlockNumber: status.latestBlockNumber,
    shardId: 'root',
  };
  const signed = signDeploy(deployData, DEPLOYER_PRIV);

  const deployResp = await fetch(`${HTTP}/api/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  });
  const deployBody = await deployResp.text();
  console.log('deploy HTTP', deployResp.status, ':', deployBody.slice(0, 120));
  if (!deployResp.ok) {
    console.log('DEPLOY REJECTED:', deployBody);
    process.exit(1);
  }
  const deployId = deployBody.match(/DeployId is: ([0-9a-fA-F]+)/)?.[1];
  console.log('deployId:', deployId);
  if (!deployId) process.exit(1);

  // Poll deploy-status, forcing a block via admin propose each round
  // (devnet autopropose can stall after its keepalive budget).
  let statusResult = null;
  for (let i = 0; i < 20; i++) {
    await fetch(`${ADMIN}/api/propose`, { method: 'POST' }).catch(() => {});
    await sleep(2000);
    const st = await (await fetch(`${HTTP}/api/v1/deploy-status/${deployId}`)).json();
    if (st.ProcessedWithSuccess) {
      statusResult = st.ProcessedWithSuccess;
      console.log('RESULT: ProcessedWithSuccess');
      console.log('deployResult:', JSON.stringify(st.ProcessedWithSuccess.deployResult));
      console.log('block:', st.ProcessedWithSuccess.block.blockHash, '#' + st.ProcessedWithSuccess.block.blockNumber);
      break;
    }
    if (st.ProcessedWithError) {
      statusResult = st.ProcessedWithError;
      console.log('RESULT: ProcessedWithError:', JSON.stringify(st.ProcessedWithError.deployError));
      break;
    }
    if (i % 5 === 4) console.log('  ...still', JSON.stringify(st));
  }
  if (!statusResult) console.log('timed out waiting for processing');

  // Check target balance via explore-deploy
  const bal = await (await fetch(`${HTTP}/api/explore-deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fn_check_balance(targetAddr)),
  })).json();
  console.log('target balance (base units):', bal.expr?.[0]?.ExprInt, '=>', (bal.expr?.[0]?.ExprInt ?? 0) / 100000000, 'REV');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
