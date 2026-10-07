const fs=require("fs"),path=require("path"),admin=require("firebase-admin");
const PROJECT_ID="w-odt-track-manager-cf9c7", seedFile=path.join(__dirname,"users-seed.json");
if(!process.env.GOOGLE_APPLICATION_CREDENTIALS){console.error("ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.");process.exit(1);}
const users=JSON.parse(fs.readFileSync(seedFile,"utf8"));
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:PROJECT_ID});
const db=admin.firestore();
(async()=>{const b=db.batch();for(const [id,u] of Object.entries(users))b.set(db.collection("users").doc(id),u,{merge:true});await b.commit();console.log(`SUCCESS: ${Object.keys(users).length} users uploaded to Firestore.`);})().catch(e=>{console.error("UPLOAD FAILED:",e);process.exit(1);});
