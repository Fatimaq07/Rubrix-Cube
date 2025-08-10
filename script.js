import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.155.0/examples/jsm/controls/OrbitControls.js';

// ==========================
// NxNxN Rubik's Cube App (module)
// Single-file, modular, commented and ready to run
// ==========================

(function(){
  // Core variables
  const canvas = document.getElementById('three-canvas');
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45,2,0.1,1000);
  const controls = new OrbitControls(camera, renderer.domElement);

  // UI elements
  const inputN = document.getElementById('inputN');
  const buildBtn = document.getElementById('buildBtn');
  const scrambleBtn = document.getElementById('scrambleBtn');
  const solveBtn = document.getElementById('solveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toggleMarkersBtn = document.getElementById('toggleMarkers');
  const moveButtonsDiv = document.getElementById('moveButtons');
  const historyDiv = document.getElementById('history');
  const exportArea = document.getElementById('exportArea');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const speedSlider = document.getElementById('speed');
  const dprSlider = document.getElementById('dpr');

  // Parameters
  let N = Math.max(1, Math.min(20, parseInt(inputN.value || 3)));
  let spacing = 1.02; // gap between cubies
  let cubeSize = N; // logical
  let stickerScale = 0.9; // sticker size relative to cubie face
  let markerEnabled = false;

  // Three.js scene setup
  camera.position.set(5,5,9);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirL = new THREE.DirectionalLight(0xffffff, 0.6);
  dirL.position.set(5,10,7);
  scene.add(dirL);

  // Performance settings
  function setDPR() {
    const val = parseFloat(dprSlider.value);
    renderer.setPixelRatio(window.devicePixelRatio * val);
  }
  dprSlider.addEventListener('input', setDPR);
  setDPR();

  // Color scheme (Singmaster): U,W; D,Y; F,G; B,B; L,O; R,R
  const FACE_COLORS = {
    U: 0xffffff, // white
    D: 0xffff00, // yellow
    F: 0x00aa00, // green
    B: 0x0000aa, // blue
    L: 0xff7700, // orange
    R: 0xaa0000  // red
  };
  const FACE_ORDER = ['U','R','F','D','L','B']; // used for consistent indexing

  // Materials for six faces — we will create one InstancedMesh per face color
  const faceMaterials = {};

  // InstancedMesh containers for sticker faces
  const faceInstanced = {}; // FACE -> InstancedMesh

  // Logical cube state: 3D array of cubie objects. Each cubie has stickers keyed by face with color char or null
  let cubeState = null; // cubeState[x][y][z] where coords in 0..N-1

  // Sticker index mapping: list of all sticker instances with metadata
  // Each sticker: {face, x,y,z, pos:THREE.Vector3, normal:THREE.Vector3, instanceIndex}
  let stickers = [];

  // For instance transforms we will maintain base (model) matrix per sticker
  let baseMatrices = []; // array of THREE.Matrix4

  // Move history: list of move objects {face:'U', layer:0-based, turns:1}  turns: +1 clockwise 90deg, -1 ccw
  let moveHistory = [];
  let redoStack = [];

  // Animation queue
  let animPromise = Promise.resolve();

  // Configurable animation duration getter
  function getAnimDuration() { return parseInt(speedSlider.value); }

  // Utility: create materials per face color
  function ensureMaterials(){
    for(const f of Object.keys(FACE_COLORS)){
      if(!faceMaterials[f]){
        faceMaterials[f] = new THREE.MeshStandardMaterial({color:FACE_COLORS[f], roughness:0.5, metalness:0});
      }
    }
  }

  // Build logical cube state and initialize visuals
  function buildCube(newN){
    N = Math.max(1, Math.min(20, parseInt(newN||inputN.value||3)));
    cubeSize = N;
    stickers.length = 0;
    baseMatrices.length = 0;
    moveHistory = [];
    redoStack = [];
    historyDiv.textContent = '';

    // cleanup old instanced meshes (dispose geometry but keep shared materials)
    for(const k in faceInstanced){
      const o = faceInstanced[k];
      if(o) { scene.remove(o); if(o.geometry) o.geometry.dispose(); }
    }
    Object.keys(faceInstanced).forEach(k=>delete faceInstanced[k]);

    ensureMaterials();

    // Create logical cube: initialize center coordinates
    cubeState = new Array(N);
    for(let x=0;x<N;x++){
      cubeState[x] = new Array(N);
      for(let y=0;y<N;y++){
        cubeState[x][y] = new Array(N);
        for(let z=0;z<N;z++){
          const cubie = { stickers: {} };
          // determine if on a face and assign stickers
          if(y === N-1) cubie.stickers['U']='U';
          if(y === 0)   cubie.stickers['D']='D';
          if(z === N-1) cubie.stickers['F']='F';
          if(z === 0)   cubie.stickers['B']='B';
          if(x === 0)   cubie.stickers['L']='L';
          if(x === N-1) cubie.stickers['R']='R';
          cubeState[x][y][z] = cubie;
        }
      }
    }

    // Build sticker geometry as small planes slightly offset from cubelet faces
    const stickerPlane = new THREE.PlaneGeometry(1*stickerScale,1*stickerScale);
    // one InstancedMesh per face type for efficient rendering
    for(const face of Object.keys(FACE_COLORS)){
      const mat = faceMaterials[face];
      const inst = new THREE.InstancedMesh(stickerPlane, mat, N*N*N*1.2 | 0);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      faceInstanced[face]=inst;
      scene.add(inst);
    }

    // iterate cubies and create sticker instances
    let counters = {}; for(const f of Object.keys(FACE_COLORS)) counters[f]=0;
    const half = (N-1)/2;
    for(let x=0;x<N;x++){
      for(let y=0;y<N;y++){
        for(let z=0;z<N;z++){
          const cubie = cubeState[x][y][z];
          // world position of cubie center
          const pos = new THREE.Vector3((x-half)*spacing, (y-half)*spacing, (z-half)*spacing);
          // for each sticker on this cubie, compute sticker center and normal
          for(const f in cubie.stickers){
            const normal = faceToNormal(f);
            const stickerPos = pos.clone().add(normal.clone().multiplyScalar(0.51)); // slightly offset
            // create matrix
            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion();
            q.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
            m.makeRotationFromQuaternion(q);
            m.setPosition(stickerPos);

            const idx = counters[f]++;
            faceInstanced[f].setMatrixAt(idx, m);
            faceInstanced[f].instanceMatrix.needsUpdate = true;

            // record sticker metadata
            stickers.push({ face:f, x, y, z, pos:stickerPos.clone(), normal:normal.clone(), instanceIndex:idx });
            baseMatrices.push(m.clone());
          }
        }
      }
    }

    // trim instance count usage by setting count property
    for(const f in faceInstanced){
      faceInstanced[f].count = counters[f];
    }

    // Center camera
    controls.target.set(0,0,0);
    controls.update();
    updateHistoryUI();
  }

  // map face letter to normal vector
  function faceToNormal(f){
    switch(f){
      case 'U': return new THREE.Vector3(0,1,0);
      case 'D': return new THREE.Vector3(0,-1,0);
      case 'F': return new THREE.Vector3(0,0,1);
      case 'B': return new THREE.Vector3(0,0,-1);
      case 'L': return new THREE.Vector3(-1,0,0);
      case 'R': return new THREE.Vector3(1,0,0);
    }
    return new THREE.Vector3(0,0,1);
  }

  // Raycasting: find clicked sticker and return sticker record
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  function onPointerDown(e){
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // check against each face instanced meshes
    const candidates = Object.values(faceInstanced);
    const intersects = raycaster.intersectObjects(candidates, true);
    if(intersects.length>0){
      const it = intersects[0];
      const obj = it.object;
      // instanceId from intersect
      const instanceId = it.instanceId;
      if(instanceId===undefined || instanceId===null) return;
      // find sticker with matching object and instanceIndex
      const faceKey = Object.keys(faceInstanced).find(k=>faceInstanced[k]===obj);
      const sticker = stickers.find(s=>s.face===faceKey && s.instanceIndex===instanceId);
      if(sticker){
        // on click: select layer based on face normal and coordinate
        // if shift pressed, rotate layer
        if(e.shiftKey){
          // rotate layer +1
          queueMove(sticker, +1);
        } else {
          // just highlight layer briefly
          highlightLayerFromSticker(sticker);
        }
      }
    }
  }

  // highlight: animate a tiny scale on the stickers of that layer
  function highlightLayerFromSticker(sticker){
    const axis = getAxisFromNormal(sticker.normal);
    const layerIndex = getLayerIndexFromSticker(sticker, axis);
    // briefly animate rotation 0.15 rad and back
    animateLayerRotation(axis, layerIndex, 0.15, 100).catch(()=>{});
  }

  function getAxisFromNormal(normal){
    const a = new THREE.Vector3(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
    if(a.x>0.5) return 'x';
    if(a.y>0.5) return 'y';
    return 'z';
  }
  function getLayerIndexFromSticker(sticker, axis){
    // return index 0..N-1 along axis
    if(axis==='x') return sticker.x;
    if(axis==='y') return sticker.y;
    return sticker.z;
  }

  // Queue a move: from sticker determine face (U,R,F,D,L,B) and layer depth; turns is +1 (90deg) or -1
  function queueMove(sticker, turns){
    // choose the face normal axis closest to camera? We'll map sticker.face to face
    // For simplicity, map sticker.face to move face and compute equivalent layer index
    const face = sticker.face;
    // layer index depends: for face letter, layer measured from that face side
    let layerIndex;
    switch(face){
      case 'U': layerIndex = sticker.y; break;
      case 'D': layerIndex = sticker.y; break;
      case 'F': layerIndex = sticker.z; break;
      case 'B': layerIndex = sticker.z; break;
      case 'L': layerIndex = sticker.x; break;
      case 'R': layerIndex = sticker.x; break;
    }
    // push move and execute
    const move = {face, layer:layerIndex, turns:turns||1};
    performMove(move, true);
  }

  // performMove: apply to logical state and animate; record in history if record=true
  function performMove(move, record=true){
    // normalize turns to -3..+3
    move.turns = ((move.turns%4)+4)%4; if(move.turns>2) move.turns -=4;
    const axis = faceToAxis(move.face);
    // convert face layer to index from smallest coordinate (0..N-1)
    let layerIndex = move.layer;
    // For faces that are measured from max side, if face is U/F/R, their 'outer' is N-1; but we stored layer as absolute coords so it's fine

    // enqueue animation chain to prevent overlap
    animPromise = animPromise.then(()=> animateAndApplyMove(axis, layerIndex, move.turns, move.face)).then(()=>{
      if(record){ moveHistory.push(move); redoStack.length=0; updateHistoryUI(); }
    });
  }

  // map face to axis letter
  function faceToAxis(face){
    if(face==='U' || face==='D') return 'y';
    if(face==='L' || face==='R') return 'x';
    return 'z';
  }

  // Animate and apply the move to logical state: turns * 90° clockwise when looking at the face from outside
  async function animateAndApplyMove(axis, layerIndex, turns, faceLetter){
    if(turns===0) return;
    // determine which stickers are affected: those whose coordinate on axis equals layerIndex
    const affected = stickers.map((s,i)=>({s,i})).filter(si=>{
      const s = si.s;
      if(axis==='x') return s.x===layerIndex;
      if(axis==='y') return s.y===layerIndex;
      return s.z===layerIndex;
    });

    // precompute original positions and normals - store stable snapshot (including face & instanceIndex)
    const originals = affected.map(a=>({
      index: a.i,
      face: a.s.face,
      instanceIndex: a.s.instanceIndex,
      pos: a.s.pos.clone(),
      normal: a.s.normal.clone(),
      mat: (baseMatrices[a.i] ? baseMatrices[a.i].clone() : new THREE.Matrix4())
    }));

    // animation uses quaternion around center of layer
    const layerCenter = new THREE.Vector3();
    const half=(N-1)/2;
    if(axis==='x') layerCenter.set((layerIndex-half)*spacing,0,0);
    if(axis==='y') layerCenter.set(0,(layerIndex-half)*spacing,0);
    if(axis==='z') layerCenter.set(0,0,(layerIndex-half)*spacing);

    const sign = getMoveSignForFace(axis, faceLetter);
    const totalAngle = -Math.sign(turns)*Math.PI/2 * sign; // direction convention
    const duration = getAnimDuration();

    // animate from 0..totalAngle
    const start = performance.now();
    await new Promise(resolve => {
      function frame(){
        const t = Math.min(1,(performance.now()-start)/duration);
        const eased = easeInOutCubic(t);
        const angle = totalAngle*eased;
        const q = new THREE.Quaternion();
        const axisVec = axis==='x' ? new THREE.Vector3(1,0,0) : axis==='y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
        q.setFromAxisAngle(axisVec, angle);

        // update instance matrices for affected stickers
        for(const o of originals){
          // transform around layerCenter using snapshot data
          const p = o.pos.clone().sub(layerCenter).applyQuaternion(q).add(layerCenter);
          // rotate normal as well
          const n = o.normal.clone().applyQuaternion(q);
          // make matrix from normal => rotate plane to face normal
          const m = new THREE.Matrix4();
          const qq = new THREE.Quaternion();
          qq.setFromUnitVectors(new THREE.Vector3(0,0,1), n);
          m.makeRotationFromQuaternion(qq);
          m.setPosition(p);
          // set into corresponding instanced mesh using stable face & instanceIndex
          const inst = faceInstanced[o.face];
          if(inst && (o.instanceIndex !== undefined && o.instanceIndex !== null)){
            try{ inst.setMatrixAt(o.instanceIndex, m); inst.instanceMatrix.needsUpdate = true; } catch(err){ /* guard: skip invalid updates */ }
          }
        }

        if(t<1) requestAnimationFrame(frame);
        else resolve();
      }
      frame();
    });

    // After animation completes: update logical cube state (permute stickers)
    applyLogicalRotation(axis, layerIndex, turns, faceLetter);
    // rebuild baseMatrices for stickers (update positions/normals and matrices)
    rebuildBaseMatricesFromState();
    // refresh instanced meshes with baseMatrices
    for(const sidx in stickers){
      const s = stickers[sidx];
      const inst = faceInstanced[s.face];
      if(inst && (s.instanceIndex !== undefined && s.instanceIndex !== null)){
        try{ inst.setMatrixAt(s.instanceIndex, baseMatrices[sidx]); inst.instanceMatrix.needsUpdate = true; }catch(e){ }
      }
    }
  }

  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

  // get sign to determine whether rotation direction is inverted for certain faces
  function getMoveSignForFace(axis, face){
    // This ensures that a clockwise move of face letter corresponds to viewers perspective of that face.
    // We'll use a convention mapping manually.
    const map = { U:1, D:-1, F:1, B:-1, L:-1, R:1 };
    return map[face]||1;
  }

  // apply permutation on cubeState: rotate stickers positions within the layer and also rotate sticker face letters accordingly
  function applyLogicalRotation(axis, layerIndex, turns, faceLetter){
    // We'll rotate the coordinates of cubies in the layer and update each cubie's stickers mapping
    const times = ((turns%4)+4)%4;
    for(let t=0;t<Math.abs(times);t++){
      // build temp copy of layer cubies
      const get = (x,y,z)=>JSON.parse(JSON.stringify(cubeState[x][y][z]));
      const set = (x,y,z,val)=>{ cubeState[x][y][z] = val; };
      const half=N-1;
      // rotate coordinates mapping depending on axis and direction
      // We will compute new positions for cubies in the layer and assign rotated sticker labels
      const layerCoords = [];
      for(let x=0;x<N;x++) for(let y=0;y<N;y++) for(let z=0;z<N;z++){
        if((axis==='x' && x===layerIndex) || (axis==='y' && y===layerIndex) || (axis==='z' && z===layerIndex)) layerCoords.push([x,y,z]);
      }
      // temporary map
      const tempMap = {};
      for(const [x,y,z] of layerCoords){
        tempMap[[x,y,z]] = JSON.parse(JSON.stringify(cubeState[x][y][z]));
      }

      // rotation function for coordinates around center of layer
      const rot = ([x,y,z])=>{
        // translate to centered coords -half..+half
        const cx = x-half, cy = y-half, cz = z-half;
        let nx=cx, ny=cy, nz=cz;
        if(axis==='x'){
          // rotate around x: (y,z) -> ( -z, y ) for 90deg cw
          nx = cx; ny = -cz; nz = cy;
        } else if(axis==='y'){
          // rotate around y: (x,z) -> ( z, y, -x )? careful
          nx = cz; ny = cy; nz = -cx;
        } else {
          // axis z rotate: (x,y) -> ( -y, x )
          nx = -cy; ny = cx; nz = cz;
        }
        return [nx+half, ny+half, nz+half];
      };

      // apply rotation times sign depending on face orientation
      const sign = getMoveSignForFace(axis, faceLetter);
      // If turns negative, rotate opposite: but we've taken times absolute; apply sign by possibly inverting rot direction
      const effectiveRot = (coords)=>{
        if(sign>=0) return rot(coords);
        // apply inverse rotation (three times rot)
        let r = rot(coords); r = rot(r); r = rot(r); return r;
      };

      // create new layer content
      const newLayer = {};
      for(const [x,y,z] of layerCoords){
        const to = effectiveRot([x,y,z]);
        const fromKey = [x,y,z];
        newLayer[to] = tempMap[fromKey];
      }

      // assign back
      for(const [x,y,z] of layerCoords){
        cubeState[x][y][z] = newLayer[[x,y,z]] || cubeState[x][y][z];
      }

      // Now inside each cubie, rotate sticker face letters themselves to account for orientation change
      // For each cubie in the layer, remap stickers: U->R etc. This is tricky but we can rotate the sticker orientations by rotating their normals.
      for(const [x,y,z] of layerCoords){
        const cubie = cubeState[x][y][z];
        const newStickers = {};
        for(const f in cubie.stickers){
          // compute normal vector of this face in current state (faceToNormal)
          const n = faceToNormal(f);
          // rotate normal by 90deg around axis
          const axisVec = axis==='x' ? new THREE.Vector3(1,0,0) : axis==='y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
          const q = new THREE.Quaternion(); q.setFromAxisAngle(axisVec, Math.sign(turns)*Math.PI/2 * getMoveSignForFace(axis,faceLetter));
          const nr = n.clone().applyQuaternion(q);
          // find which face letter nr is closest to
          let best = 'U'; let bestDot=-9;
          for(const cand of Object.keys(FACE_COLORS)){
            const candN = faceToNormal(cand);
            const d = nr.dot(candN);
            if(d>bestDot){ bestDot=d; best=cand; }
          }
          newStickers[best] = cubie.stickers[f];
        }
        cubie.stickers = newStickers;
      }
    }
  }

  // After logical rotation, rebuild stickers[] positions and baseMatrices to reflect new cubeState
  function rebuildBaseMatricesFromState(){
    stickers.length=0; baseMatrices.length=0;
    // rebuild counters
    let counters = {}; for(const f of Object.keys(FACE_COLORS)) counters[f]=0;
    const half=(N-1)/2;
    const stickerPlane = null; // not needed
    for(let x=0;x<N;x++) for(let y=0;y<N;y++) for(let z=0;z<N;z++){
      const pos = new THREE.Vector3((x-half)*spacing, (y-half)*spacing, (z-half)*spacing);
      const cubie = cubeState[x][y][z];
      for(const f in cubie.stickers){
        const normal = faceToNormal(f);
        const stickerPos = pos.clone().add(normal.clone().multiplyScalar(0.51));
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion(); q.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
        m.makeRotationFromQuaternion(q);
        m.setPosition(stickerPos);
        const idx = counters[f]++;
        // assign instanceIndex per face and push into arrays
        stickers.push({ face:f, x,y,z, pos:stickerPos.clone(), normal:normal.clone(), instanceIndex:idx });
        baseMatrices.push(m.clone());
      }
    }
    // update instanced mesh counts
    for(const f in faceInstanced){ faceInstanced[f].count = counters[f]; }
  }

  // Utility: perform undo
  function undo(){
    if(moveHistory.length===0) return;
    const last = moveHistory.pop();
    const inverse = { face:last.face, layer:last.layer, turns:-last.turns };
    redoStack.push(last);
    performMove(inverse, false);
    updateHistoryUI();
  }
  function redo(){
    if(redoStack.length===0) return;
    const m = redoStack.pop();
    performMove(m, true);
  }

  // Scramble generator: produce sequence of random moves
  function scramble(count=20){
    const faces = Object.keys(FACE_COLORS);
    const seq=[];
    let lastFace = null;
    for(let i=0;i<count;i++){
      let face = faces[Math.floor(Math.random()*faces.length)];
      while(face===lastFace) face = faces[Math.floor(Math.random()*faces.length)];
      lastFace = face;
      const turns = [1,1,1, -1][Math.floor(Math.random()*4)]; // bias
      const layer = Math.floor(Math.random()*N);
      seq.push({face,layer,turns});
    }
    // perform sequentially and record
    (async ()=>{
      for(const m of seq){ performMove(m, true); await animPromise; }
    })();
  }

  // Solve: animate exact inverse of recorded moveHistory in reverse order
  function solve(){
    if(moveHistory.length===0) return;
    const inverseSeq = moveHistory.slice().reverse().map(m=>({face:m.face, layer:m.layer, turns:-m.turns}));
    // execute step-by-step with clear transitions
    (async ()=>{
      for(const mv of inverseSeq){ performMove(mv, false); await animPromise; }
      // clear history after solving
      moveHistory.length=0; redoStack.length=0; updateHistoryUI();
    })();
  }

  // Update history UI
  function updateHistoryUI(){
    historyDiv.innerHTML = moveHistory.map((m,i)=>`${i+1}. ${m.face}${m.layer>0?m.layer+"":""}${m.turns===-1?"'":(m.turns===2?"2":"")}`).join('<br>');
  }

  // Export / import
  function exportState(){
    const exportObj = { N, cubeState, moveHistory };
    exportArea.value = JSON.stringify(exportObj);
  }
  function importState(){
    try{
      const obj = JSON.parse(exportArea.value);
      if(!obj || !obj.N) throw new Error('Invalid');
      buildCube(obj.N);
      if(obj.cubeState){ cubeState = obj.cubeState; rebuildBaseMatricesFromState();
        // write matrices to instanced meshes
        for(const sidx in stickers){ const s = stickers[sidx]; const inst = faceInstanced[s.face]; if(inst && (s.instanceIndex!==undefined && s.instanceIndex!==null)){ try{ inst.setMatrixAt(s.instanceIndex, baseMatrices[sidx]); inst.instanceMatrix.needsUpdate=true; }catch(e){} } }
      }
      if(Array.isArray(obj.moveHistory)) moveHistory = obj.moveHistory;
      updateHistoryUI();
    }catch(e){ alert('Failed to import state: '+e.message); }
  }

  // Helpers for rotating layer by small temporary animation (e.g., highlight)
  function animateLayerRotation(axis, layerIndex, angle, duration){
    const affected = stickers.map((s,i)=>({s,i})).filter(si=>{
      const s=si.s; if(axis==='x') return s.x===layerIndex; if(axis==='y') return s.y===layerIndex; return s.z===layerIndex; });
    const originals = affected.map(a=>({ index:a.i, face:a.s.face, instanceIndex:a.s.instanceIndex, pos:a.s.pos.clone(), normal:a.s.normal.clone(), mat: (baseMatrices[a.i]?baseMatrices[a.i].clone():new THREE.Matrix4()) }));
    const start = performance.now();
    return new Promise(resolve=>{
      function frame(){
        const t = Math.min(1,(performance.now()-start)/duration);
        const eased = Math.sin(t*Math.PI);
        const current = angle*eased;
        const q = new THREE.Quaternion();
        const axisVec = axis==='x'?new THREE.Vector3(1,0,0):axis==='y'?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1);
        q.setFromAxisAngle(axisVec, current);
        for(const o of originals){
          const p = o.pos.clone().applyQuaternion(q);
          const n = o.normal.clone().applyQuaternion(q);
          const m = new THREE.Matrix4(); const qq = new THREE.Quaternion(); qq.setFromUnitVectors(new THREE.Vector3(0,0,1), n); m.makeRotationFromQuaternion(qq); m.setPosition(p);
          const inst = faceInstanced[o.face]; if(inst && (o.instanceIndex!==undefined && o.instanceIndex!==null)){ try{ inst.setMatrixAt(o.instanceIndex, m); inst.instanceMatrix.needsUpdate=true; }catch(e){} }
        }
        if(t<1) requestAnimationFrame(frame); else resolve();
      }
      frame();
    });
  }

  // build UI move buttons Singmaster: U D L R F B and their primes and 2 variants
  const faces = ['U','R','F','D','L','B'];
  function makeMoveButtons(){
    moveButtonsDiv.innerHTML='';
    for(const f of faces){
      const b = document.createElement('button'); b.textContent = f; b.onclick = ()=>{ performFaceMoveFromUI(f,1); };
      const b2 = document.createElement('button'); b2.textContent = f+"'"; b2.onclick = ()=>{ performFaceMoveFromUI(f,-1); };
      const b3 = document.createElement('button'); b3.textContent = f+"2"; b3.onclick = ()=>{ performFaceMoveFromUI(f,2); };
      moveButtonsDiv.appendChild(b); moveButtonsDiv.appendChild(b2); moveButtonsDiv.appendChild(b3);
    }
  }
  function performFaceMoveFromUI(face, turns){
    // default to outer layer index (if N>1 outer is N-1 for R,F,U and 0 for L,B,D? We'll choose outer as max index for R,F,U and 0 for others to match viewer notation)
    const outerIndex = {'U':N-1,'R':N-1,'F':N-1,'D':0,'L':0,'B':0}[face]||0;
    performMove({face, layer:outerIndex, turns}, true);
  }

  // keyboard shortcuts
  window.addEventListener('keydown', (e)=>{
    if(e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA')) return;
    const key = e.key.toUpperCase();
    if(['U','D','L','R','F','B'].includes(key)){
      // check for modifier ' to invert
      const turns = e.shiftKey ? -1 : 1;
      performFaceMoveFromUI(key, turns);
    }
    if(e.key==='Z' && (e.ctrlKey||e.metaKey)) undo();
    if(e.key==='Y' && (e.ctrlKey||e.metaKey)) redo();
  });

  // UI bindings
  buildBtn.addEventListener('click', ()=>buildCube(inputN.value));
  scrambleBtn.addEventListener('click', ()=>scramble(Math.max(10, Math.min(200, N*10))));
  solveBtn.addEventListener('click', ()=>solve());
  resetBtn.addEventListener('click', ()=>{ buildCube(N); });
  toggleMarkersBtn.addEventListener('click', ()=>{ markerEnabled = !markerEnabled; alert('Color-blind markers toggled: '+markerEnabled); });
  exportBtn.addEventListener('click', exportState);
  importBtn.addEventListener('click', importState);
  undoBtn.addEventListener('click', undo); redoBtn.addEventListener('click', redo);

  makeMoveButtons();

  // Resize handling
  function resize(){
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    camera.aspect = w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }
  window.addEventListener('resize', resize);

  // main render loop
  function render(now){
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  // initial build and start render
  buildCube(N);
  resize();
  requestAnimationFrame(render);

  // ==================================================
  // Notes & optimizations in comments:
  // - We render only sticker faces as InstancedMesh (6 instanced meshes). That reduces draw calls and allows large N.
  // - Logical state is kept in cubeState (3D array). Move history stores moves as permutations to allow undo/redo.
  // - Animations compute per-sticker instance matrices on the fly during rotation, then commit new base matrices after logical state update.
  // - Device pixel ratio slider multiplies window.devicePixelRatio for performance tuning.
  // - For very large N you can reduce stickerScale or DPR to keep FPS.
  // - This implementation uses clone/JSON approach for cubie copying for clarity; for extreme performance, use typed arrays and in-place permutation functions.
  // - Solve function simply plays inverse of recorded moves; for a real cube solver (optimal solution) integrate Kociemba or similar algorithm.
  // ==================================================

})();