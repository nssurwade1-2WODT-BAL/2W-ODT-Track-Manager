/*
  One-time Firestore Test Master seeder
  Project: w-odt-track-manager-cf9c7

  Usage:
    1. Put your edited test-master-seed.json beside this file.
    2. Create/download a Firebase service-account key locally.
    3. Set GOOGLE_APPLICATION_CREDENTIALS to that JSON key.
    4. Run:
         npm install firebase-admin
         node seed-test-master.js

  The script upserts every document in test-master-seed.json into:
      testMaster/<documentId>

  It does NOT delete documents that are absent from the JSON.
  It also validates the required fields before writing.
*/

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PROJECT_ID = "w-odt-track-manager-cf9c7";
const COLLECTION = "testMaster";
const SEED_FILE = path.join(__dirname, "test-master-seed.json");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("\nERROR: GOOGLE_APPLICATION_CREDENTIALS is not set.");
  console.error("Set it to the path of your Firebase service-account JSON key.");
  console.error("Example (Command Prompt):");
  console.error('  set GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\service-account.json');
  process.exit(1);
}

if (!fs.existsSync(SEED_FILE)) {
  console.error(`\nERROR: Seed file not found: ${SEED_FILE}`);
  process.exit(1);
}

let seed;
try {
  seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
} catch (err) {
  console.error("\nERROR: Could not read test-master-seed.json:", err.message);
  process.exit(1);
}

if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
  console.error("\nERROR: test-master-seed.json must contain an object keyed by document ID.");
  process.exit(1);
}

const entries = Object.entries(seed);

for (const [id, data] of entries) {
  if (!data || typeof data !== "object") {
    console.error(`Invalid document ${id}: data must be an object.`);
    process.exit(1);
  }

  if (typeof data.testName !== "string" || !data.testName.trim()) {
    console.error(`Invalid document ${id}: testName must be a non-empty string.`);
    process.exit(1);
  }

  if (data.direction !== "Bidirectional" && data.direction !== "Unidirectional") {
    console.error(
      `Invalid document ${id}: direction must be "Bidirectional" or "Unidirectional".`
    );
    process.exit(1);
  }

  if (typeof data.active !== "boolean") {
    console.error(`Invalid document ${id}: active must be true/false.`);
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID
});

const db = admin.firestore();

async function main() {
  const batch = db.batch();

  for (const [id, data] of entries) {
    const ref = db.collection(COLLECTION).doc(String(id));
    const cleanData = {
      testName: data.testName.trim(),
      direction: data.direction,
      active: data.active
    };

    // Preserve order if present, but don't require it.
    if (typeof data.order === "number") {
      cleanData.order = data.order;
    }

    batch.set(ref, cleanData, { merge: true });
  }

  await batch.commit();

  console.log(`\nSUCCESS: ${entries.length} testMaster documents uploaded.`);
  console.log(`Collection: ${COLLECTION}`);
  console.log("\nUploaded documents:");
  for (const [id, data] of entries) {
    console.log(`  ${id}  |  ${data.testName}  |  ${data.direction}  |  active=${data.active}`);
  }

  console.log("\nThe script only upserted the JSON records.");
  console.log("It did NOT delete other Firestore testMaster documents.");
}

main().catch(err => {
  console.error("\nUPLOAD FAILED:");
  console.error(err);
  process.exit(1);
});
