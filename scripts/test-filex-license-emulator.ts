import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import { handleLicensingRequest } from "../apps/filex-cloud-functions/src/licensing-api.js";
import { hashLicenseSecret } from "../apps/filex-cloud-functions/src/licensing-core.js";
import { verifyLicenseAttestation } from "../apps/filex-cloud-functions/src/license-attestation.js";

for (const variable of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) assert.match(process.env[variable] ?? "", /^127\.0\.0\.1:\d+$/, `${variable}: emulator locale obbligatorio`);
const app = initializeApp({ projectId: "demo-filex-license-audit" });
const db = getFirestore(app); const auth = getAuth(app);
const keys = generateKeyPairSync("ed25519");
const signingPrivateKey = keys.privateKey.export({type:"pkcs8",format:"pem"}).toString();
const publicKey = keys.publicKey.export({type:"spki",format:"pem"}).toString();
const server = createServer(async (request,response) => {
  try {
    const chunks=[]; for await (const chunk of request) chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString() || "{}");
    await handleLicensingRequest(db, {path:request.url,method:request.method,headers:request.headers,body,ip:request.headers["x-test-ip"] || "127.0.0.1",get:(key:string)=>request.headers[key]} as unknown as Request,
      {status:(status:number)=>({json:(payload:unknown)=>{response.writeHead(status,{"content-type":"application/json"});response.end(JSON.stringify(payload));}})}, {signingPrivateKey,paypalLicenseKeySecret:"isolated-audit"});
  } catch(error) { response.writeHead(500); response.end(JSON.stringify({error:String(error)})); }
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
let requests=0;
async function post(path:string, body:unknown, expected=200, token?:string) {
  const response=await fetch(base+"/licensing"+path,{method:"POST",headers:{"content-type":"application/json","x-test-ip":`test-${requests++}`,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const payload=await response.json() as any; assert.equal(response.status,expected,JSON.stringify(payload)); return payload;
}
async function identity(email:string, verified=true) {
  const user=await auth.createUser({email,password:"Audit-only-password-123!",emailVerified:verified});
  const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:"Audit-only-password-123!",returnSecureToken:true})});
  const data=await response.json() as {idToken:string}; assert.ok(data.idToken); return {...user,token:data.idToken};
}
async function session(device="a".repeat(64),pollSecret=randomBytes(32).toString("base64url")) {
  const installationId=randomUUID(); const pairing=await post("/trial/session",{installationId,deviceIdHash:device,pollSecret});
  return {...pairing,installationId,pollSecret};
}
try {
  const owner=await identity("owner@example.test"); const other=await identity("other@example.test"); const unverified=await identity("unverified@example.test",false);
  const pairing=await session(); const approval={code:pairing.code,acceptedTerms:true};
  await post("/trial/approve",approval,401);
  await post("/trial/approve",approval,401,unverified.token);
  await post("/trial/approve",{...approval,acceptedTerms:false},400,owner.token);
  const approvals=await Promise.all([post("/trial/approve",approval,200,owner.token),post("/trial/approve",approval,200,owner.token)]);
  assert.equal(approvals[0].validUntil,approvals[1].validUntil);
  const trial=await post("/trial/poll",pairing);
  assert.equal(verifyLicenseAttestation(trial.attestation,publicKey)?.entitlement.trial,true);
  const credentials={activationToken:trial.activationToken,installationId:pairing.installationId};
  await post("/validate",{...credentials,installationId:randomUUID()},401);
  await post("/trial/approve",approval,409,other.token);
  await post("/account/devices/deactivate",{activationId:hashLicenseSecret(`trial-${hashLicenseSecret(owner.uid)}:trial`)},403,other.token);
  await post("/deactivate",credentials);
  await post("/validate",credentials,401);
  await post("/trial/approve",approval,200,owner.token);
  await post("/trial/poll",pairing,401);
  const recovered=await session(); const remaining=await post("/trial/approve",{code:recovered.code,acceptedTerms:true},200,owner.token);
  assert.equal(remaining.validUntil,approvals[0].validUntil);
  await db.collection("licenseSubscriptions").doc(`trial-${hashLicenseSecret(owner.uid)}`).update({currentPeriodEnd:Date.now()-1});
  const expired=await session(); await post("/trial/approve",{code:expired.code,acceptedTerms:true},409,owner.token);
  const key="FILEX-AUDIT-PAID-KEY"; const paidRef=db.collection("licenseSubscriptions").doc("paid-audit");
  await paidRef.set({provider:"audit",entitlement:"filex-all-access",status:"active",currentPeriodEnd:Date.now()+86400000,licenseKeyHash:hashLicenseSecret(key)});
  const installs=[randomUUID(),randomUUID(),randomUUID()];
  const paid=await post("/activate",{licenseKey:key,installationId:installs[0]});
  await post("/activate",{licenseKey:key,installationId:installs[1]});
  await post("/activate",{licenseKey:key,installationId:installs[2]},409);
  await paidRef.update({status:"refunded"});
  assert.equal((await post("/validate",{activationToken:paid.activationToken,installationId:installs[0]})).entitlement.status,"revoked");
  await post("/activate",{licenseKey:key,installationId:installs[0]},401);
  await post("/deactivate",{activationToken:paid.activationToken,installationId:installs[0]});
  console.log("PASS emulator Firebase: email verification, consent, concurrent approval, signed proof, ownership, reinstall, expiry, paid device limit, refund and deactivation.");
} finally { await new Promise<void>(resolve=>server.close(()=>resolve())); await db.terminate(); await deleteApp(app); }
