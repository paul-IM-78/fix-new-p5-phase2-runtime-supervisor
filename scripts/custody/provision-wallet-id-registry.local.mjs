import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const WALLET_ID_PATTERN = /^[0-9a-f]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,63}$/;

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assertSafeOption(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("local_registry_input_invalid");
}

async function readWalletId() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (!WALLET_ID_PATTERN.test(value)) throw new Error("local_registry_wallet_id_invalid");
  return value;
}

function localConnection() {
  const value = process.env.P6_T11_LOCAL_DATABASE_URL;
  if (!value) throw new Error("local_registry_connection_missing");
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("local_registry_connection_invalid");
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || (url.port && url.port !== '55722')) {
    throw new Error("local_registry_remote_target_rejected");
  }
  if (decodeURIComponent(url.username) !== "custody_wallet_id_registry_provisioner") {
    throw new Error("local_registry_role_invalid");
  }
  return value;
}

async function main() {
  const operation = readOption("--operation");
  const reason = readOption("--reason");
  const commandId = readOption("--command-id");
  const registryId = readOption("--registry-id");
  const bindingId = readOption("--binding-id");
  const expectedVersion = readOption("--expected-version");
  if (!['provision', 'replace', 'deactivate'].includes(operation) || process.argv.some((value) => value.startsWith('--wallet'))) {
    throw new Error("local_registry_operation_invalid");
  }
  assertSafeOption(reason, REASON_PATTERN);
  assertSafeOption(commandId, UUID_PATTERN);
  const pool = new Pool({ connectionString: localConnection(), max: 1 });
  try {
    if (operation === "provision") {
      assertSafeOption(bindingId, UUID_PATTERN);
      const walletId = await readWalletId();
      await pool.query("select * from private.provision_custody_wallet_id_registry($1::uuid, 'TEST', $2::text, $3::uuid, $4::text)", [bindingId, walletId, commandId, reason]);
    } else if (operation === "replace") {
      assertSafeOption(registryId, UUID_PATTERN);
      assertSafeOption(expectedVersion, /^[1-9][0-9]*$/);
      const walletId = await readWalletId();
      await pool.query("select * from private.replace_custody_wallet_id_registry($1::uuid, $2::bigint, $3::text, $4::uuid, $5::text)", [registryId, expectedVersion, walletId, commandId, reason]);
    } else {
      assertSafeOption(registryId, UUID_PATTERN);
      assertSafeOption(expectedVersion, /^[1-9][0-9]*$/);
      if ((await readWalletId().catch(() => "")) !== "") throw new Error("local_registry_deactivate_stdin_must_be_empty");
      await pool.query("select * from private.deactivate_custody_wallet_id_registry($1::uuid, $2::bigint, $3::uuid, $4::text)", [registryId, expectedVersion, commandId, reason]);
    }
    console.log("P6_T11_WALLET_ID_REGISTRY_LOCAL_OPERATION=COMPLETE");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("P6_T11_WALLET_ID_REGISTRY_LOCAL_OPERATION=FAILED");
  process.exitCode = 1;
});
