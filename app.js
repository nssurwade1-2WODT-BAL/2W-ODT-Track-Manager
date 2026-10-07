/*
  2W ODT Track Manager
  Version 0.1 - Frontend prototype

  Authentication:
  - Designed to call a future backend API.
  - Temporary local demo authentication is enabled until backend endpoints exist.
  - Firebase Authentication is NOT used.

  Data:
  - Temporary localStorage repository is enabled for this prototype.
  - Replace the repository methods with Firebase Firestore/Realtime Database calls later.
*/

const CONFIG = {
  AUTH_API_BASE: "", // Example future backend: "https://your-backend.example.com/api"
  DATA_MODE: "firebase", // Firestore is authoritative for users, requests and live track state
  STORAGE_KEY: "odtTrackManagerV1"
};


// Phase 2: Firestore Test Master
// Active testMaster documents are used as the authoritative test list.
// The existing local list remains a safe fallback until Firestore is seeded.
const FIRESTORE_TEST_MASTER = { collection: "testMaster" };
let firestoreTestsLoaded = false;

async function loadTestMasterFromFirestore(){
  if (!window.ODTFirebase || !window.ODTFirebase.db) {
    console.warn("Firestore unavailable; using local test master.");
    populateTests();
    return;
  }

  try {
    const snapshot = await window.ODTFirebase.db
      .collection(FIRESTORE_TEST_MASTER.collection)
      .where("active", "==", true)
      .get();

    if (snapshot.empty) {
      console.warn("Firestore testMaster is empty. No remote tests are available; using local test master as fallback.");
      populateTests();
      return;
    }

    const remoteTests = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(t =>
        t.testName &&
        (t.direction === "Bidirectional" || t.direction === "Unidirectional")
      )
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

    if (!remoteTests.length) {
      populateTests();
      return;
    }

    TESTS.length = 0;
    remoteTests.forEach(t => TESTS.push({
      id: t.id,
      name: t.testName,
      direction: t.direction
    }));

    firestoreTestsLoaded = true;
    populateTests();
    console.info(`Loaded ${TESTS.length} tests from Firestore.`);
  } catch (error) {
    console.error("Failed to load Firestore test master; using local test master.", error);
    populateTests();
  }
}

const TESTS = [
  ["IS brake performance test","Bidirectional"],
  ["Acceleration performance","Bidirectional"],
  ["Coast down test","Bidirectional"],
  ["ABS tuning","Bidirectional"],
  ["ABS performance / ABS Efficiency test","Bidirectional"],
  ["Traction Control / Cruise control / Speed Control","Bidirectional"],
  ["Brake foundation test","Bidirectional"],
  ["Disc fade test","Bidirectional"],
  ["Handling & Stability test","Unidirectional"],
  ["Suspension Comfort","Unidirectional"],
  ["Drivability test","Unidirectional"],
  ["Subjective NVH test","Unidirectional"],
  ["Seat comfort test","Unidirectional"],
  ["Handling ground clearance test","Unidirectional"],
  ["Rider posture ergonomic test","Unidirectional"],
  ["Pillion posture ergonomic test","Unidirectional"],
  ["Control switch ergonomic test","Unidirectional"],
  ["Control lever ergonomic test","Unidirectional"],
  ["Mirror target visibility","Unidirectional"],
  ["Mirror blow back & stability/vibration test","Unidirectional"],
  ["Tyre test","Unidirectional"],
  ["Fuel surge test","Unidirectional"],
  ["Brake switch activation test","Unidirectional"],
  ["Track thermal test","Unidirectional"],
  ["Rider interface ergonomic test","Unidirectional"],
  ["Speedometer interface test","Unidirectional"]
].map(([name,direction]) => ({name,direction}));

const DEMO_USERS = [
  {id:"manager", password:"manager123", name:"Demo Manager", role:"Manager"},
  {id:"rider", password:"rider123", name:"Demo Rider", role:"Rider"},
  {id:"external", password:"external123", name:"Demo External", role:"External"}
];

let currentUser = null;
let state = loadState();
let activeTab = "live";

function defaultState(){
  return { users:[...DEMO_USERS], requests:[], history:[] };
}
function loadState(){
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
    if(saved) return { users: saved.users || [...DEMO_USERS], requests: saved.requests || [], history: saved.history || [] };
  } catch(e){}
  const initial = defaultState();
  localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(initial));
  return initial;
}
function saveState(){
  localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
}

let usersUnsubscribe = null;

function subscribeToUsers(){
  if(!window.ODTFirebase?.db) return;
  if(usersUnsubscribe) usersUnsubscribe();

  usersUnsubscribe=window.ODTFirebase.db.collection("users").onSnapshot(snapshot=>{
    state.users=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
    saveState();
    if(currentUser) render();
  },error=>{
    console.error("Firestore user listener failed.",error);
  });
}

async function loadUsersFromFirestore(){
  if(!window.ODTFirebase?.db) return false;
  try{
    const snapshot=await window.ODTFirebase.db.collection("users").get();
    if(!snapshot.empty){
      state.users=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
      saveState();
      console.info(`Loaded ${state.users.length} users from Firestore.`);
    }

    subscribeToUsers();
    return true;
  }catch(error){
    console.error("Failed to load users from Firestore; using local users.",error);
    return false;
  }
}

let requestsUnsubscribe = null;

function firestoreRequestCollection(){
  if(!window.ODTFirebase?.db) throw new Error("Firestore unavailable.");
  return window.ODTFirebase.db.collection("requests");
}

async function loadRequestsFromFirestore(){
  if(!window.ODTFirebase?.db) return false;
  try{
    const snapshot=await firestoreRequestCollection().get();

    // One-time migration of any requests already present in this browser.
    if(snapshot.empty && state.requests.length){
      const batch=window.ODTFirebase.db.batch();
      state.requests.forEach(r=>{
        batch.set(firestoreRequestCollection().doc(r.id), r);
      });
      await batch.commit();
      console.info(`Migrated ${state.requests.length} local requests to Firestore.`);
    }else{
      state.requests=snapshot.docs.map(doc=>simplifyRequest({id:doc.id,...doc.data()}));
      saveState();
    }

    subscribeToRequests();
    return true;
  }catch(error){
    console.error("Failed to load requests from Firestore; using local requests.",error);
    return false;
  }
}

function simplifyRequest(r){
  // PENDING/APPROVED are legacy values from the previous approval workflow.
  // Both are now treated as WAITING.
  const normalizedStatus = (r.status === "PENDING" || r.status === "APPROVED") ? "WAITING" : (r.status || "WAITING");
  return {
    id:r.id,
    date:r.date || dateKey(),
    riderId:r.riderId || "",
    riderName:r.riderName || "",
    pillionId:r.pillionId || "",
    pillionName:r.pillionName || "",
    vehicle:r.vehicle || "",
    testName:r.testName || "",
    direction:r.direction || "",
    status:normalizedStatus,
    startTime:r.startTime || null,
    endTime:r.endTime || null,
    createdAt:r.createdAt || null,
    createdById:r.createdById || "",
    createdByName:r.createdByName || ""
  };
}

function subscribeToRequests(){
  if(!window.ODTFirebase?.db) return;
  if(requestsUnsubscribe) requestsUnsubscribe();
  requestsUnsubscribe=firestoreRequestCollection().onSnapshot(snapshot=>{
    state.requests=snapshot.docs.map(doc=>simplifyRequest({id:doc.id,...doc.data()}));
    saveState();
    if(currentUser) render();
  },error=>{
    console.error("Firestore request listener failed.",error);
  });
}

async function writeRequestToFirestore(request){
  await firestoreRequestCollection().doc(request.id).set(request);
}

async function updateRequestInFirestore(request){
  await firestoreRequestCollection().doc(request.id).set(request,{merge:true});
}

async function deleteRequestFromFirestore(requestId){
  await firestoreRequestCollection().doc(requestId).delete();
}

function normalizeUserId(value){
  return String(value || "").trim().toLowerCase();
}
function normalizeUserName(value){
  return String(value || "").trim().replace(/\s+/g," ").toLowerCase();
}

async function userExistsInFirestore(userId, name){
  if(!window.ODTFirebase?.db) throw new Error("Firestore unavailable.");
  const targetId=normalizeUserId(userId);
  const targetName=normalizeUserName(name);

  // User IDs are document IDs, but we still scan IDs case-insensitively
  // so Rider01 and rider01 cannot coexist.
  const snapshot=await window.ODTFirebase.db.collection("users").get();
  for(const doc of snapshot.docs){
    const data=doc.data() || {};
    if(normalizeUserId(doc.id)===targetId) return {id:true,name:false};
    if(normalizeUserName(data.name)===targetName) return {id:false,name:true};
  }
  return {id:false,name:false};
}

async function createUserInFirestore(user){
  if(!window.ODTFirebase?.db) throw new Error("Firestore unavailable.");
  const duplicate=await userExistsInFirestore(user.id,user.name);
  if(duplicate.id) throw new Error("DUPLICATE_USER_ID");
  if(duplicate.name) throw new Error("DUPLICATE_USER_NAME");

  // Store the trimmed canonical User ID. The document ID itself is unique.
  await window.ODTFirebase.db.collection("users").doc(user.id).set({
    name:user.name.trim().replace(/\s+/g," "),
    role:user.role,
    password:user.password
  });
}

async function deleteUserFromFirestore(userId){
  if(!window.ODTFirebase?.db) throw new Error("Firestore unavailable.");
  await window.ODTFirebase.db.collection("users").doc(userId).delete();
}

async function authenticate(userId,password){
  if(CONFIG.AUTH_API_BASE){
    const r=await fetch(`${CONFIG.AUTH_API_BASE}/auth/login`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({userId,password}),credentials:"include"
    });
    if(!r.ok) throw new Error("Invalid User ID or Password");
    return await r.json();
  }
  if(window.ODTFirebase?.db){
    try{
      const doc=await window.ODTFirebase.db.collection("users").doc(userId).get();
      if(doc.exists){
        const user={id:doc.id,...doc.data()};
        if(user.password!==password) throw new Error("Invalid User ID or Password");
        return {user:{id:user.id,name:user.name,role:user.role}};
      }
    }catch(error){
      if(error.message==="Invalid User ID or Password") throw error;
      console.warn("Firestore login lookup failed; falling back to local users.",error);
    }
  }
  const user=state.users.find(u=>u.id===userId&&u.password===password);
  if(!user) throw new Error("Invalid User ID or Password");
  return {user:{id:user.id,name:user.name,role:user.role}};
}

function uid(prefix="id"){ return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function now(){ return new Date(); }
function dateKey(d=now()){
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const day = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function localTime(d){ return new Intl.DateTimeFormat([], {hour:"2-digit",minute:"2-digit",hour12:true}).format(new Date(d)); }
function localDate(d){ return new Intl.DateTimeFormat([], {day:"2-digit",month:"short",year:"numeric"}).format(new Date(d)); }
function durationText(start){
  if(!start) return "—";
  const sec = Math.max(0, Math.floor((Date.now()-new Date(start).getTime())/1000));
  const h=String(Math.floor(sec/3600)).padStart(2,"0");
  const m=String(Math.floor((sec%3600)/60)).padStart(2,"0");
  const s=String(sec%60).padStart(2,"0");
  return `${h}:${m}:${s}`;
}
function directionClass(d){ return d==="Bidirectional" ? "bi" : "uni"; }

async function authenticate(userId,password){
  // FUTURE BACKEND CONTRACT:
  // POST `${CONFIG.AUTH_API_BASE}/auth/login`
  // body: { userId, password }
  // response: { token, user:{id,name,role} }
  if(CONFIG.AUTH_API_BASE){
    const r = await fetch(`${CONFIG.AUTH_API_BASE}/auth/login`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({userId,password}),credentials:"include"
    });
    if(!r.ok) throw new Error("Invalid User ID or Password");
    return await r.json();
  }
  const user = state.users.find(u => u.id === userId && u.password === password);
  if(!user) throw new Error("Invalid User ID or Password");
  return {user:{id:user.id,name:user.name,role:user.role}};
}

async function logout(){
  if(CONFIG.AUTH_API_BASE){
    try { await fetch(`${CONFIG.AUTH_API_BASE}/auth/logout`,{method:"POST",credentials:"include"}); } catch(e){}
  }
  currentUser=null;
  localStorage.removeItem("odtCurrentUser"); sessionStorage.removeItem("odtCurrentUser");
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
}

function getRequestsToday(){
  return state.requests.filter(r => r.date === dateKey());
}
function isOtherTrackTest(r){
  const testName = typeof r === "string" ? r : r?.testName;
  return typeof testName === "string" && (testName.startsWith("Bad-Road:") || testName.startsWith("Off-Road:"));
}
function activeRequests(){ return getRequestsToday().filter(r => r.status==="ACTIVE" && !isOtherTrackTest(r)); }
function otherTrackActiveRequests(){ return getRequestsToday().filter(r => r.status==="ACTIVE" && isOtherTrackTest(r)); }
function waitingRequests(){ return getRequestsToday().filter(r => r.status==="WAITING"); }

function reservedMode(){
  const active = activeRequests();
  return active.length ? active[0].direction : null;
}
function capacityFor(mode){ return mode==="Bidirectional" ? 2 : mode==="Unidirectional" ? 3 : null; }
function isManager(){ return currentUser?.role === "Manager"; }
function isRider(){ return currentUser?.role === "Rider"; }
function isExternal(){ return currentUser?.role === "External"; }
function userOwnsRequest(r){ return normalizeUserName(r.riderName) === normalizeUserName(currentUser?.name); }
function userCreatedRequest(r){ return normalizeUserId(r.createdById) === normalizeUserId(currentUser?.id) || normalizeUserName(r.createdByName) === normalizeUserName(currentUser?.name); }
function riderHasUnfinishedRequest(riderName, excludeId=""){
  const key=normalizeUserName(riderName);
  return getRequestsToday().some(r =>
    r.id!==excludeId && normalizeUserName(r.riderName)===key && ["WAITING","ACTIVE"].includes(r.status)
  );
}
function hasBlockingRequest(){
  return riderHasUnfinishedRequest(currentUser?.name);
}
function trackCapacityAvailable(direction){
  const active=activeRequests();
  const mode=reservedMode();
  if(!mode) return true;
  if(mode!==direction) return false;
  return active.length < capacityFor(mode);
}
function canStart(r){
  if(!r || r.status!=="WAITING") return false;
  // External users can operate only their own assigned Rider test.
  if(isExternal() && !userOwnsRequest(r)) return false;
  if(!isExternal() && !isManager() && !isRider()) return false;
  if(riderHasUnfinishedRequest(r.riderName, r.id)) return false;
  if(isOtherTrackTest(r)) return true;
  return trackCapacityAvailable(r.direction);
}
function startBlockReason(r){
  if(!r || r.status!=="WAITING") return "Request is not waiting.";
  if(riderHasUnfinishedRequest(r.riderName, r.id)) return "Rider already has another active or waiting test.";
  if(isOtherTrackTest(r)) return "Ready to start.";
  const active=activeRequests();
  const mode=reservedMode();
  if(mode && mode!==r.direction) return `Track is currently reserved for ${mode} testing.`;
  if(mode && active.length>=capacityFor(mode)) return `Track is full (${active.length}/${capacityFor(mode)} ${mode}).`;
  return "Ready to start.";
}

function render(){
  if(!currentUser) return;
  document.getElementById("currentUserLabel").textContent = `${currentUser.name} · ${currentUser.role}`;
  document.getElementById("todayDateLabel").textContent = localDate(now());
  document.querySelectorAll(".manager-only").forEach(el => el.classList.toggle("hidden",!isManager()));
  document.querySelector(".manager-nav").classList.toggle("hidden",!isManager());
  const isExternal = currentUser?.role === "External";
  document.querySelector(".history-nav")?.classList.toggle("hidden", isExternal);
  document.querySelector(".history-page")?.classList.toggle("hidden", isExternal);
  if(!isManager() && activeTab==="users") switchTab("live");
  if(isExternal && activeTab==="history") switchTab("live");
  renderLive(); renderRequests(); renderToday(); renderHistory(); renderUsers();
}

function renderLive(){
  const active=activeRequests(), otherActive=otherTrackActiveRequests(), waiting=waitingRequests(), mode=reservedMode(), cap=capacityFor(mode);
  const badge=document.getElementById("trackStatusBadge");
  let status="TRACK EMPTY", cls="empty";
  if(mode){
    status=active.length>=cap?"TRACK FULL":"TRACK AVAILABLE";
    cls=active.length>=cap?"full":"available";
  }
  badge.textContent=status; badge.className=`status-badge ${cls}`;
  document.getElementById("currentMode").textContent=mode?mode.toUpperCase():"EMPTY";
  document.getElementById("activeCapacity").textContent=mode?`${active.length} / ${cap}`:"0 / —";
  document.getElementById("approvedCount").textContent=waiting.length;
  document.getElementById("activeCountText").textContent=`${active.length} active test${active.length===1?"":"s"}`;

  const activeBox=document.getElementById("activeTests");
  activeBox.innerHTML=active.length ? active.map(r => cardHTML(r,"active")).join("") : emptyHTML("No test is currently active on the track.");
  const otherTrackSection=document.getElementById("otherTrackSection");
  const otherTrackBox=document.getElementById("otherTrackActivity");
  if(otherTrackSection) otherTrackSection.classList.toggle("hidden",otherActive.length===0);
  if(otherTrackBox) otherTrackBox.innerHTML=otherActive.length ? otherActive.map(r => cardHTML(r,"active")).join("") : "";
  const waitingBox=document.getElementById("approvedTests");
  waitingBox.innerHTML=waiting.length ? waiting.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).map(r => cardHTML(r,"waiting")).join("") : emptyHTML("No waiting test requests.");
}

function cardHTML(r, view){
  let actions="";
  if(view==="active"){
    if(isManager() || isRider() || (isExternal() && userOwnsRequest(r))){
      actions+=`<button class="btn danger" onclick="endTest('${r.id}')">End Test</button>`;
    }
  }
  if(view==="waiting"){
    if(canStart(r)) actions+=`<button class="btn success" onclick="startTest('${r.id}')">Start Test</button>`;
    if(isManager() || userOwnsRequest(r) || userCreatedRequest(r)) actions+=`<button class="btn danger" onclick="cancelRequest('${r.id}')">Cancel</button>`;
  }
  const timing = r.status==="ACTIVE" ? `<p><strong>Started:</strong> ${localTime(r.startTime)} · <span data-timer="${r.id}">${durationText(r.startTime)}</span></p>` :
                 `<p><strong>Status:</strong> ${r.status} · ${escapeHTML(startBlockReason(r))}</p>`;
  return `<article class="request-card">
    <div class="request-main">
      <h4>${escapeHTML(r.vehicle)}</h4>
      <p>${escapeHTML(r.testName)} · Rider: ${escapeHTML(r.riderName)}${r.pillionName?` · Pillion: ${escapeHTML(r.pillionName)}`:""}</p>
      ${timing}
      <div class="request-meta"><span class="tag ${directionClass(r.direction)}">${r.direction}</span><span class="tag">${r.status}</span></div>
    </div>
    <div class="request-actions">${actions}</div>
  </article>`;
}

function emptyHTML(text){ return `<div class="empty-state">${text}</div>`; }

function renderRequests(){
  const box=document.getElementById("pendingRequests");
  const mode=reservedMode(), active=activeRequests().length;
  document.getElementById("newRequestBtn").disabled=false;
  document.getElementById("requestModeInfo").textContent = mode
    ? `Current track mode is ${mode}. Active: ${active}/${capacityFor(mode)}. Waiting requests can start when eligible.`
    : "Track is currently empty. The first valid test to start determines the track direction.";

  const list=waitingRequests().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  box.innerHTML=list.length ? list.map(r => `
    <article class="request-card">
      <div class="request-main">
        <h4>${escapeHTML(r.vehicle)}</h4>
        <p>${escapeHTML(r.testName)} · Rider: ${escapeHTML(r.riderName)}${r.pillionName?` · Pillion: ${escapeHTML(r.pillionName)}`:""}</p>
        <p><strong>WAITING</strong> — ${escapeHTML(startBlockReason(r))}</p>
        <div class="request-meta"><span class="tag ${directionClass(r.direction)}">${r.direction}</span><span class="tag">WAITING</span></div>
      </div>
      <div class="request-actions">
        ${canStart(r)?`<button class="btn success" onclick="startTest('${r.id}')">Start Test</button>`:""}
        ${(isManager()||userOwnsRequest(r)||userCreatedRequest(r))?`<button class="btn danger" onclick="cancelRequest('${r.id}')">Cancel</button>`:""}
      </div>
    </article>`).join("") : emptyHTML("No waiting track requests.");
}

function renderToday(){
  const rows=getRequestsToday().filter(r=>["ACTIVE","COMPLETED"].includes(r.status))
    .sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  document.getElementById("todayTableBody").innerHTML=rows.length?rows.map(r=>`
    <tr><td>${escapeHTML(r.riderName)}${r.pillionName ? ", " + escapeHTML(r.pillionName) : ""}</td><td class="time-cell nowrap-cell">${localTime(r.startTime)}</td>
     <td class="time-cell nowrap-cell">${r.endTime?localTime(r.endTime):"—"}</td><td>${escapeHTML(r.direction)}</td>
    <td>${escapeHTML(r.vehicle)}</td><td>${escapeHTML(r.testName)}</td>
    <td>${r.status}</td></tr>`).join(""):`<tr><td colspan="7" class="muted">No testing records for today.</td></tr>`;
}

function getHistoryRecords(){
  const from=(document.getElementById("historyFromDate")?.value||"");
  const to=(document.getElementById("historyToDate")?.value||"");

  // History is derived from completed requests in Firestore.
  // state.requests is kept synchronized by the Firestore onSnapshot listener.
  // Only COMPLETED requests belong in History; pending/approved/active requests do not.
  const records=state.requests.filter(r=>r.status==="COMPLETED");

  return records
    .filter(r=>{
      const d = r.date || (r.startTime ? localDate(r.startTime) : "");
      return (!from || d>=from) && (!to || d<=to);
    })
    .sort((a,b)=>{
      const aTime = new Date(a.endTime || a.startTime || 0).getTime();
      const bTime = new Date(b.endTime || b.startTime || 0).getTime();
      return bTime-aTime;
    });
}

let historyVisibleCount=100;

function renderHistory(){
  const records=getHistoryRecords();
  const visible=records.slice(0,historyVisibleCount);
  const tbody=document.getElementById("historyTableBody");
  tbody.innerHTML=visible.length?visible.map(r=>`
    <tr><td class="date-cell nowrap-cell">${localDate(r.startTime)}</td><td>${escapeHTML(r.riderName)}${r.pillionName ? ", " + escapeHTML(r.pillionName) : ""}</td>
     <td>${escapeHTML(r.vehicle)}</td><td>${escapeHTML(r.testName)}</td>
     <td>${escapeHTML(r.direction)}</td><td class="time-cell nowrap-cell">${localTime(r.startTime)}</td><td class="time-cell nowrap-cell">${localTime(r.endTime)}</td></tr>`).join("")
    :`<tr><td colspan="7" class="muted">No historical records for the selected date range.</td></tr>`;

  const info=document.getElementById("historyResultInfo");
  if(info){
    info.textContent=records.length
      ? `Showing ${visible.length} of ${records.length} records`
      : "No records found";
  }

  const more=document.getElementById("historyLoadMore");
  if(more) more.classList.toggle("hidden", visible.length>=records.length);
}

function resetHistoryPaging(){
  historyVisibleCount=100;
  renderHistory();
}

function clearHistoryFilters(){
  const from=document.getElementById("historyFromDate");
  const to=document.getElementById("historyToDate");
  if(from) from.value="";
  if(to) to.value="";
  resetHistoryPaging();
}

function exportHistoryToExcel(){
  const records=getHistoryRecords();
  if(!records.length){
    toast("No history records to export.");
    return;
  }

  // Create an Excel-compatible .xls file directly in the browser.
  // This avoids relying on an external XLSX/CDN library.
  const headers=["Date","Rider/Pillion","Test Vehicle","Test Name","Direction","Start Time","End Time"];
  const esc=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const rows=records.map(r=>[
    r.startTime ? localDate(r.startTime) : (r.date||""),
    r.riderName ? r.riderName + (r.pillionName ? ", " + r.pillionName : "") : "",
    r.vehicle||"",
    r.testName||"",
    r.direction||"",
    r.startTime ? localTime(r.startTime) : "",
    r.endTime ? localTime(r.endTime) : ""
  ]);

  const tableRows=[
    `<tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr>`,
    ...rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`)
  ].join("");

  const htmlFile=`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
table{border-collapse:collapse;font-family:Arial,sans-serif}
th,td{border:1px solid #999;padding:6px 10px;white-space:nowrap}
th{font-weight:bold}
</style>
</head>
<body>
<table>${tableRows}</table>
</body>
</html>`;

  const blob=new Blob([htmlFile],{type:"application/vnd.ms-excel;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;

  const from=document.getElementById("historyFromDate")?.value||"";
  const to=document.getElementById("historyToDate")?.value||"";
  let filename="2W-ODT-History";
  if(from && to) filename+=`_${from}_to_${to}`;
  else if(from) filename+=`_from_${from}`;
  else if(to) filename+=`_up_to_${to}`;
  filename+=".xls";

  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);

  toast(`${records.length} history records exported.`);
}

function renderUsers(){
  if(!isManager()) return;
  const box=document.getElementById("usersList");
  if(!state.users.length){ box.innerHTML=emptyHTML("No users found."); return; }
  box.innerHTML=state.users.map(u=>`<article class="request-card">
    <div class="request-main">
      <h4>${escapeHTML(u.name)}</h4>
      <p>User ID: ${escapeHTML(u.id)}</p>
      <div class="request-meta"><span class="tag">${escapeHTML(u.role)}</span></div>
    </div>
    <div class="request-actions">
      ${u.id===currentUser?.id ? `<span class="muted">Current user</span>` :
      `<button class="btn danger small" onclick="deleteUser('${escapeHTML(u.id)}')">Delete</button>`}
    </div>
  </article>`).join("");
}

async function deleteUser(userId){
  if(!isManager()) return;
  if(userId===currentUser.id){ toast("You cannot delete your own account."); return; }
  const user=state.users.find(u=>u.id===userId);
  if(!user) return;
  const hasActive=state.requests.some(r=>normalizeUserName(r.riderName)===normalizeUserName(user.name)&&r.date===dateKey()&&r.status==="ACTIVE");
  if(hasActive){ toast("Cannot delete a user while they have an active test."); return; }
  if(!confirm(`Delete user "${user.name}" (${user.id})?`)) return;
  try{
    if(CONFIG.DATA_MODE==="firebase") await deleteUserFromFirestore(userId);
    state.users=state.users.filter(u=>u.id!==userId);
    saveState(); render(); toast("User deleted.");
  }catch(error){
    console.error(error); toast("Unable to delete user.");
  }
}

async function createRequest(e){
  e.preventDefault();
  const riderId=document.getElementById("requestRider").value;
  const pillionId=document.getElementById("requestPillion").value;
  const rider=state.users.find(u=>u.id===riderId);
  const pillion=pillionId ? state.users.find(u=>u.id===pillionId) : null;
  const vehicle=document.getElementById("vehicleName").value.trim();
  const testName=document.getElementById("testName").value;
  const test=TESTS.find(t=>t.name===testName);

  if(!rider || !vehicle || !test){ toast("Select a Rider, enter a vehicle and select a test."); return; }
  if(pillion && pillion.id===rider.id){ toast("Rider and Pillion cannot be the same person."); return; }
  if(riderHasUnfinishedRequest(rider.name)){ toast("This Rider already has a waiting or active request."); return; }

  const request={
    id:uid("req"),
    date:dateKey(),
    riderId:rider.id,
    riderName:rider.name,
    pillionId:pillion?.id||"",
    pillionName:pillion?.name||"",
    vehicle,
    testName:test.name,
    direction:test.direction,
    status:"WAITING",
    startTime:null,
    endTime:null,
    createdAt:now().toISOString(),
    createdById:currentUser.id,
    createdByName:currentUser.name
  };

  try{
    if(CONFIG.DATA_MODE==="firebase") await writeRequestToFirestore(request);
    else state.requests.push(request);
    saveState();
    closeModal("requestModal");
    e.target.reset();
    populateRequestUsers();
    document.getElementById("testDirectionPreview").textContent="Select a test to see track direction";
    render();
    toast("Track request submitted.");
  }catch(error){
    console.error(error);
    toast("Unable to submit request.");
  }
}

async function cancelRequest(id){
  const r=state.requests.find(x=>x.id===id); if(!r) return;
  if(!isManager()&&!userOwnsRequest(r)&&!userCreatedRequest(r)) return toast("You cannot cancel this request.");
  if(r.status!=="WAITING") return toast("Only waiting requests can be cancelled.");
  r.status="CANCELLED";
  try{
    if(CONFIG.DATA_MODE==="firebase") await updateRequestInFirestore(r);
    else saveState();
    render(); toast("Request cancelled.");
  }catch(error){ console.error(error); toast("Unable to cancel request."); }
}

async function startTest(id){
  // Refresh the latest Firestore state before a start attempt. This keeps the
  // existing browser-side architecture while reducing stale capacity checks.
  if(CONFIG.DATA_MODE==="firebase"){
    try{
      const snapshot=await firestoreRequestCollection().get();
      state.requests=snapshot.docs.map(doc=>simplifyRequest({id:doc.id,...doc.data()}));
    }catch(error){ console.error(error); }
  }
  const r=state.requests.find(x=>x.id===id);
  if(!r||!canStart(r)) return toast(`Test cannot be started. ${r?startBlockReason(r):"Request not found."}`);
  r.status="ACTIVE"; r.startTime=now().toISOString();
  try{
    if(CONFIG.DATA_MODE==="firebase") await updateRequestInFirestore(r); else saveState();
    render(); toast("Test started.");
  }catch(error){ console.error(error); toast("Unable to start test."); }
}

async function endTest(id){
  const r=state.requests.find(x=>x.id===id);
  if(!r||r.status!=="ACTIVE") return;
  if(!isManager()&&!isRider()&&!(isExternal()&&userOwnsRequest(r))) return;
  if(!confirm(`End test for Rider ${r.riderName}?`)) return;
  r.status="COMPLETED"; r.endTime=now().toISOString();
  try{
    if(CONFIG.DATA_MODE==="firebase") await updateRequestInFirestore(r); else saveState();
    render(); toast("Test ended and saved.");
  }catch(error){ console.error(error); toast("Unable to end test."); }
}

function escapeHTML(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function switchTab(tab){
  activeTab=tab;
  document.querySelectorAll(".tab-page").forEach(p=>p.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  render();
}
function openModal(id){document.getElementById(id).classList.remove("hidden")}
function closeModal(id){document.getElementById(id).classList.add("hidden")}
function toast(message){
  const t=document.getElementById("toast");t.textContent=message;t.classList.remove("hidden");
  clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>t.classList.add("hidden"),3000);
}

document.getElementById("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const err=document.getElementById("loginError");err.textContent="";
  try{
    const result=await authenticate(document.getElementById("loginUserId").value.trim(),document.getElementById("loginPassword").value);
    currentUser=result.user;localStorage.setItem("odtCurrentUser",JSON.stringify(currentUser));
    document.getElementById("loginView").classList.add("hidden");document.getElementById("appView").classList.remove("hidden");render();
  }catch(error){err.textContent=error.message||"Login failed."}
});
document.getElementById("logoutBtn").addEventListener("click",logout);
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
document.getElementById("newRequestBtn").addEventListener("click",()=>{populateRequestUsers();openModal("requestModal")});
document.getElementById("newUserBtn").addEventListener("click",()=>openModal("userModal"));
document.querySelectorAll(".close-modal").forEach(b=>b.addEventListener("click",()=>b.closest(".modal").classList.add("hidden")));
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.add("hidden")}));
document.getElementById("requestForm").addEventListener("submit",createRequest);
document.getElementById("testName").addEventListener("change",e=>{
  const test=TESTS.find(t=>t.name===e.target.value);const p=document.getElementById("testDirectionPreview");
  p.textContent=test?`Track direction: ${test.direction} (automatically determined)`:"Select a test to see track direction";
});
document.getElementById("requestRider").addEventListener("change",()=>{
  const rider=document.getElementById("requestRider");
  const pillion=document.getElementById("requestPillion");
  if(pillion.value===rider.value) pillion.value="";
});
document.getElementById("requestPillion").addEventListener("change",()=>{
  const rider=document.getElementById("requestRider");
  const pillion=document.getElementById("requestPillion");
  if(pillion.value && pillion.value===rider.value){ pillion.value=""; toast("Rider and Pillion cannot be the same person."); }
});
function showUserFormMessage(message){
  const box=document.getElementById("userFormMessage");
  if(!box) return;
  box.textContent=message;
  box.classList.remove("hidden");
}
function clearUserFormMessage(){
  const box=document.getElementById("userFormMessage");
  if(!box) return;
  box.textContent="";
  box.classList.add("hidden");
}

document.getElementById("userForm").addEventListener("submit",async e=>{
  e.preventDefault();if(!isManager()) return;
  clearUserFormMessage();
  const id=document.getElementById("newUserId").value.trim();
  const name=document.getElementById("newUserName").value.trim();
  const password=document.getElementById("newUserPassword").value;
  const role=document.getElementById("newUserRole").value;

  if(!id || !name || !password || !role){
    showUserFormMessage("Please fill all user fields."); return;
  }

  const idKey=normalizeUserId(id);
  const nameKey=normalizeUserName(name);

  // Fast local check.
  if(state.users.some(u=>normalizeUserId(u.id)===idKey)){
    showUserFormMessage("User ID already exists."); return;
  }
  if(state.users.some(u=>normalizeUserName(u.name)===nameKey)){
    showUserFormMessage("User name already exists."); return;
  }

  const user={id:id.trim(),password,name:name.trim().replace(/\s+/g," "),role};

  try{
    if(CONFIG.DATA_MODE==="firebase"){
      await createUserInFirestore(user);
    }
    state.users.push(user);
    saveState(); closeModal("userModal"); e.target.reset(); render(); toast("User created.");
  }catch(error){
    console.error(error);
    if(error.message==="DUPLICATE_USER_ID"){
      showUserFormMessage("User ID already exists.");
    }else if(error.message==="DUPLICATE_USER_NAME"){
      showUserFormMessage("User name already exists.");
    }else{
      showUserFormMessage("Unable to create user. Check Firestore access.");
    }
  }
});
document.getElementById("historyFromDate").addEventListener("change",resetHistoryPaging);
document.getElementById("historyToDate").addEventListener("change",resetHistoryPaging);
document.getElementById("historyClearBtn").addEventListener("click",clearHistoryFilters);
document.getElementById("historyLoadMore").addEventListener("click",()=>{historyVisibleCount+=100;renderHistory();});
document.getElementById("historyExportBtn").addEventListener("click",exportHistoryToExcel);
setInterval(()=>{document.querySelectorAll("[data-timer]").forEach(el=>{const r=state.requests.find(x=>x.id===el.dataset.timer);if(r)el.textContent=durationText(r.startTime)});document.querySelectorAll("[data-wait]").forEach(el=>{const r=state.requests.find(x=>x.id===el.dataset.wait);if(r)el.textContent=waitingText(r.createdAt)});},1000);

function populateRequestUsers(){
  const riderSelect=document.getElementById("requestRider");
  const pillionSelect=document.getElementById("requestPillion");
  if(!riderSelect||!pillionSelect) return;

  const currentRider=riderSelect.value || currentUser?.id || "";
  riderSelect.innerHTML='<option value="">Select Rider</option>';
  state.users.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).forEach(u=>{
    const o=document.createElement("option"); o.value=u.id; o.textContent=u.name; riderSelect.appendChild(o);
  });
  riderSelect.value=state.users.some(u=>u.id===currentRider)?currentRider:(currentUser?.id||"");

  const currentPillion=pillionSelect.value || "";
  pillionSelect.innerHTML='<option value="">No Pillion</option>';
  state.users.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).forEach(u=>{
    const o=document.createElement("option"); o.value=u.id; o.textContent=u.name; pillionSelect.appendChild(o);
  });
  if(currentPillion && state.users.some(u=>u.id===currentPillion) && currentPillion!==riderSelect.value) pillionSelect.value=currentPillion;
}

function populateTests(){
  const s=document.getElementById("testName");
  if(!s) return;
  const currentValue=s.value;
  s.innerHTML='<option value="">Select test</option>';
  TESTS.forEach(t=>{
    const o=document.createElement("option");
    o.value=t.name;
    o.textContent=t.name;
    s.appendChild(o);
  });
  if(currentValue && TESTS.some(t=>t.name===currentValue)) s.value=currentValue;
}
async function autoCloseBeforeMidnight(){
  // Final rule: there is no maximum-duration rule. Active tests are closed only at 23:59.
  // This is intentionally browser-side to keep the project simple and free.
  const n=now();
  if(n.getHours()!==23 || n.getMinutes()!==59) return;

  const endAt=new Date(n.getFullYear(),n.getMonth(),n.getDate(),23,59,0,0).toISOString();
  const todays=state.requests.filter(r=>r.date===dateKey()&&["ACTIVE","WAITING"].includes(r.status));
  if(!todays.length) return;

  try{
    if(CONFIG.DATA_MODE==="firebase"){
      await Promise.all(todays.map(r=>{
        if(r.status==="ACTIVE"){ r.status="COMPLETED"; r.endTime=endAt; }
        else if(r.status==="WAITING"){ r.status="CANCELLED"; }
        return updateRequestInFirestore(r);
      }));
    }else{
      todays.forEach(r=>{
        if(r.status==="ACTIVE"){r.status="COMPLETED";r.endTime=endAt;}
        else if(r.status==="WAITING"){r.status="CANCELLED";}
      });
      saveState();
    }
    render();
    toast("11:59 PM end-of-day cleanup completed.");
  }catch(error){
    console.error("11:59 PM auto-close failed.",error);
    toast("Unable to complete the 11:59 PM auto-close.");
  }
}
setInterval(autoCloseBeforeMidnight,30000);

populateTests();
populateRequestUsers();
loadTestMasterFromFirestore();
loadUsersFromFirestore().then(()=>{ if(currentUser) render(); });
loadRequestsFromFirestore().then(()=>{ if(currentUser) render(); });
const savedUser=localStorage.getItem("odtCurrentUser");
if(savedUser){
  currentUser=JSON.parse(savedUser);
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  render();
}

// expose action functions for inline buttons
Object.assign(window,{cancelRequest,startTest,endTest,deleteUser,clearHistoryFilters,exportHistoryToExcel});
