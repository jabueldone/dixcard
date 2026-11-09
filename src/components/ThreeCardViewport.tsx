import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { soundEngine } from '../audio/soundEngine';
import type { CardAsset, GamePhase, Player, RevealedCardEntry } from '../types/game';

interface ThreeCardViewportProps {
  phase: GamePhase;
  cardsPool: CardAsset[];
  inspectedCardId: string | null;
  onCloseInspect: () => void;
  revealedCards: RevealedCardEntry[];
  revealedCount: number;
  selectedVoteCardId: string | null;
  onSelectVoteCard: (cardId: string) => void;
  yourSubmittedCardId: string | null;
  storytellerCardId: string | null;
  players: Player[];
  currentPlayerId: string;
}

// Pre-allocated math helpers outside the render loop (Zero GC rule)
const _mouseNDC = new THREE.Vector2();
const _targetPos = new THREE.Vector3();
const _targetScale = new THREE.Vector3();
const _sheenPos = new THREE.Vector3();

function createRoundedCardShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x, y + radius);
  shape.lineTo(x, y + height - radius);
  shape.quadraticCurveTo(x, y + height, x + radius, y + height);
  shape.lineTo(x + width - radius, y + height);
  shape.quadraticCurveTo(x + width, y + height, x + width, y + height - radius);
  shape.lineTo(x + width, y + radius);
  shape.quadraticCurveTo(x + width, y, x + width - radius, y);
  shape.lineTo(x + radius, y);
  shape.quadraticCurveTo(x, y, x, y + radius);
  return shape;
}

function createProceduralCardBackTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d')!;

  // Soft pastel gradient background
  const grad = ctx.createLinearGradient(0, 0, 512, 768);
  grad.addColorStop(0, '#ffe3ea');
  grad.addColorStop(0.35, '#e3edff');
  grad.addColorStop(0.7, '#efe6ff');
  grad.addColorStop(1, '#fdf1d4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 768);

  // Ornamental storybook frame
  ctx.strokeStyle = '#c89d66';
  ctx.lineWidth = 10;
  ctx.strokeRect(28, 28, 456, 712);

  ctx.strokeStyle = 'rgba(61, 122, 104, 0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(44, 44, 424, 680);

  // Celestial compass rose in center
  ctx.save();
  ctx.translate(256, 384);
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, -140);
    ctx.quadraticCurveTo(24, -60, 0, 0);
    ctx.quadraticCurveTo(-24, -60, 0, -140);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(224, 122, 95, 0.28)' : 'rgba(61, 122, 104, 0.25)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 56, 0, Math.PI * 2);
  ctx.fillStyle = '#f7f3ee';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#c89d66';
  ctx.stroke();

  ctx.fillStyle = '#2b303a';
  ctx.font = 'bold 28px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DIXCARD', 0, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createRoundedCardFaceTexture(
  img: HTMLImageElement,
  isGrayscale: boolean,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d')!;

  const r = 42;
  ctx.clearRect(0, 0, 600, 900);

  // Clip rounded rectangle matching TCG card silhouette
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(600 - r, 0);
  ctx.quadraticCurveTo(600, 0, 600, r);
  ctx.lineTo(600, 900 - r);
  ctx.quadraticCurveTo(600, 900, 600 - r, 900);
  ctx.lineTo(r, 900);
  ctx.quadraticCurveTo(0, 900, 0, 900 - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();

  if (isGrayscale) {
    ctx.filter = 'grayscale(100%) contrast(0.85) brightness(0.9)';
  }

  // Draw cover-fit card illustration
  ctx.drawImage(img, 0, 0, 600, 900);
  ctx.filter = 'none';

  // Inner pearl TCG border
  ctx.strokeStyle = isGrayscale ? 'rgba(160, 160, 160, 0.7)' : 'rgba(255, 248, 235, 0.85)';
  ctx.lineWidth = 18;
  ctx.stroke();

  if (isGrayscale) {
    // Subtle "YOUR CARD" ribbon across bottom so player knows why it's disabled
    ctx.fillStyle = 'rgba(43, 48, 58, 0.82)';
    ctx.fillRect(0, 770, 600, 72);
    ctx.fillStyle = '#f4efe9';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOUR SUBMITTED CARD (LOCKED)', 300, 806);
  }

  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

interface Card3DInstance {
  cardId: string;
  group: THREE.Group;
  frontMesh: THREE.Mesh;
  frontMat: THREE.MeshPhysicalMaterial;
  borderMat: THREE.MeshPhysicalMaterial;
  glowMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  basePos: THREE.Vector3;
  baseRot: THREE.Euler;
  baseScale: number;
  isGrayscale: boolean;
}

export const ThreeCardViewport: React.FC<ThreeCardViewportProps> = ({
  phase,
  cardsPool,
  inspectedCardId,
  onCloseInspect,
  revealedCards,
  revealedCount,
  selectedVoteCardId,
  onSelectVoteCard,
  yourSubmittedCardId,
  storytellerCardId,
  players,
  currentPlayerId,
}) => {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const [isDraggingTilt, setIsDraggingTilt] = useState(false);

  // Mutable ref state for the WebGL loop so React state changes never destroy the canvas
  const stateRef = useRef({
    phase,
    inspectedCardId,
    revealedCards,
    revealedCount,
    selectedVoteCardId,
    yourSubmittedCardId,
    storytellerCardId,
    onSelectVoteCard,
    onCloseInspect,
    cardsPool,
  });

  useEffect(() => {
    stateRef.current = {
      phase,
      inspectedCardId,
      revealedCards,
      revealedCount,
      selectedVoteCardId,
      yourSubmittedCardId,
      storytellerCardId,
      onSelectVoteCard,
      onCloseInspect,
      cardsPool,
    };
  }, [
    phase,
    inspectedCardId,
    revealedCards,
    revealedCount,
    selectedVoteCardId,
    yourSubmittedCardId,
    storytellerCardId,
    onSelectVoteCard,
    onCloseInspect,
    cardsPool,
  ]);

  const syncCardsTriggerRef = useRef<() => void>(() => {});

  useEffect(() => {
    syncCardsTriggerRef.current();
  }, [
    phase,
    inspectedCardId,
    revealedCards,
    revealedCount,
    selectedVoteCardId,
    yourSubmittedCardId,
    storytellerCardId,
    cardsPool,
  ]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software WebGL Guard
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf2ede7, 0.035);

    // 2. Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, -1.2, 10);
    camera.lookAt(0, -1.2, 0);

    // 3. Balanced 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xfff8f0, 0xd8e2dc, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3e0, 0.4);
    keyLight.position.set(4, 7, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe3edff, 0.6);
    rimLight.position.set(-5, -3, 4);
    scene.add(rimLight);

    // Sculpted Tabletop Pedestal & Contact Shadow Grounding
    const tableGroup = new THREE.Group();
    const tableGeo = new THREE.CylinderGeometry(8.5, 9.2, 0.35, 48);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0xebe5de,
      roughness: 0.75,
      metalness: 0.05,
    });
    const tableMesh = new THREE.Mesh(tableGeo, tableMat);
    tableMesh.position.set(0, -3.1, -1.5);
    tableMesh.receiveShadow = true;
    tableGroup.add(tableMesh);

    const tableRimGeo = new THREE.TorusGeometry(8.4, 0.08, 16, 64);
    const tableRimMat = new THREE.MeshStandardMaterial({
      color: 0xd5cdc3,
      roughness: 0.4,
      metalness: 0.3,
    });
    const tableRim = new THREE.Mesh(tableRimGeo, tableRimMat);
    tableRim.rotation.x = Math.PI / 2;
    tableRim.position.set(0, -2.92, -1.5);
    tableGroup.add(tableRim);
    scene.add(tableGroup);

    // Shared Card Geometry (Composite 4-part TCG Card Group)
    const cardW = 2.2;
    const cardH = 3.3;
    const cardR = 0.1;
    const cardShape = createRoundedCardShape(cardW, cardH, cardR);
    const extrudeGeo = new THREE.ExtrudeGeometry(cardShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.02,
      bevelThickness: 0.02,
    });
    extrudeGeo.center();

    const facePlaneGeo = new THREE.PlaneGeometry(cardW - 0.04, cardH - 0.04);
    const glowPlaneGeo = new THREE.PlaneGeometry(cardW + 0.32, cardH + 0.32);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const cardBackTex = createProceduralCardBackTexture(maxAniso);
    const backMat = new THREE.MeshPhysicalMaterial({
      map: cardBackTex,
      roughness: 0.22,
      metalness: 0.12,
      clearcoat: 0.9,
      clearcoatRoughness: 0.15,
    });

    const imageCache = new Map<string, HTMLImageElement>();
    const textureCache = new Map<string, THREE.CanvasTexture>();
    const cardInstances = new Map<string, Card3DInstance>();
    const cardsRoot = new THREE.Group();
    scene.add(cardsRoot);

    function loadCardFaceTexture(cardId: string, isGrayscale: boolean, matToUpdate: THREE.MeshPhysicalMaterial) {
      const cacheKey = `${cardId}_${isGrayscale ? 'gray' : 'color'}`;
      if (textureCache.has(cacheKey)) {
        matToUpdate.map = textureCache.get(cacheKey)!;
        matToUpdate.needsUpdate = true;
        return;
      }

      const cardMeta = stateRef.current.cardsPool.find((c) => c.id === cardId);
      const url = cardMeta?.url;
      if (!url) return;

      if (imageCache.has(url)) {
        const tex = createRoundedCardFaceTexture(imageCache.get(url)!, isGrayscale, maxAniso);
        textureCache.set(cacheKey, tex);
        matToUpdate.map = tex;
        matToUpdate.needsUpdate = true;
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCache.set(url, img);
        const tex = createRoundedCardFaceTexture(img, isGrayscale, maxAniso);
        textureCache.set(cacheKey, tex);
        matToUpdate.map = tex;
        matToUpdate.needsUpdate = true;
      };
      img.src = url;
    }

    function getOrCreateCardInstance(key: string, cardId: string, isGrayscale: boolean): Card3DInstance {
      let inst = cardInstances.get(key);
      if (inst) {
        if (inst.cardId !== cardId || inst.isGrayscale !== isGrayscale) {
          inst.cardId = cardId;
          inst.isGrayscale = isGrayscale;
          loadCardFaceTexture(cardId, isGrayscale, inst.frontMat);
        }
        return inst;
      }

      const group = new THREE.Group();
      group.userData = { instanceKey: key, cardId };

      // Part 1: Beveled Pearl/Gold Card Body Core
      const borderMat = new THREE.MeshPhysicalMaterial({
        color: 0xf4efe9,
        roughness: 0.25,
        metalness: 0.35,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
      });
      const coreMesh = new THREE.Mesh(extrudeGeo, borderMat);
      coreMesh.castShadow = !isSoftwareGl;
      coreMesh.receiveShadow = !isSoftwareGl;
      group.add(coreMesh);

      // Keep the card finish matte and readable; reduce the reflective glare so artwork stays legible.
      const frontMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0.02,
        clearcoat: 0.08,
        clearcoatRoughness: 0.9,
        iridescence: 0.04,
        iridescenceIOR: 1.05,
        iridescenceThicknessRange: [20, 60],
        transparent: true,
      });
      loadCardFaceTexture(cardId, isGrayscale, frontMat);

      const frontMesh = new THREE.Mesh(facePlaneGeo, frontMat);
      frontMesh.position.z = 0.042;
      frontMesh.userData = { instanceKey: key, cardId };
      group.add(frontMesh);

      // Part 3: Storybook Back Face
      const backMesh = new THREE.Mesh(facePlaneGeo, backMat);
      backMesh.rotation.y = Math.PI;
      backMesh.position.z = -0.042;
      group.add(backMesh);

      // Part 4: Selection / Storyteller Aura Halo Plane
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xe07a5f,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(glowPlaneGeo, glowMat);
      glowMesh.position.z = -0.05;
      group.add(glowMesh);

      // Center glare light removed: keep only the soft studio wash.
      cardsRoot.add(group);

      inst = {
        cardId,
        group,
        frontMesh,
        frontMat,
        borderMat,
        glowMesh,
        glowMat,
        basePos: new THREE.Vector3(0, -4, 0),
        baseRot: new THREE.Euler(0, Math.PI, 0),
        baseScale: 1,
        isGrayscale,
      };
      cardInstances.set(key, inst);
      return inst;
    }

    function syncSceneCards() {
      const st = stateRef.current;
      const activeKeys = new Set<string>();
      const isInspecting = st.phase !== 'SCORING' && Boolean(st.inspectedCardId);

      const isTablePhase = st.phase === 'REVEAL';

      if (isTablePhase && st.revealedCards.length > 0) {
        const count = st.revealedCards.length;
        const maxPerRow = count <= 4 ? count : Math.ceil(count / 2);
        const spacingX = count <= 3 ? 2.85 : count === 4 ? 2.45 : 2.35;

        st.revealedCards.forEach((entry, idx) => {
          const key = `table_${entry.cardId}`;
          activeKeys.add(key);

          const isOwnCardInVote =
            st.phase === 'VOTING' && entry.cardId === st.yourSubmittedCardId;
          const isStorytellerTrueCard =
            st.phase === 'SCORING' && entry.cardId === st.storytellerCardId;
          const isSelectedVote =
            st.phase === 'VOTING' && entry.cardId === st.selectedVoteCardId;

          const inst = getOrCreateCardInstance(key, entry.cardId, isOwnCardInVote);

          const row = count <= 4 ? 0 : Math.floor(idx / maxPerRow);
          const colInRow = count <= 4 ? idx : idx % maxPerRow;
          const itemsInThisRow =
            count <= 4 ? count : row === 0 ? maxPerRow : count - maxPerRow;

          const xOffset = (colInRow - (itemsInThisRow - 1) / 2) * spacingX;
          const yBase = isInspecting
            ? count <= 4
              ? -1.1
              : row === 0
                ? 0.15
                : -2.2
            : count <= 4
              ? 0.45
              : row === 0
                ? 1.55
                : -1.35;

          // Storyteller card in SCORING gets a 3D vertical lift & forward presentation
          const liftY = isStorytellerTrueCard ? 0.42 : isSelectedVote ? 0.22 : 0;
          const liftZ = isStorytellerTrueCard ? 0.85 : isSelectedVote ? 0.45 : 0;

          inst.basePos.set(xOffset, yBase + liftY, liftZ);

          // In REVEAL phase, cards beyond revealedCount stay flipped face-down (rotation.y = Math.PI)
          const isFaceUp = st.phase !== 'REVEAL' || idx < st.revealedCount;
          inst.baseRot.set(0, isFaceUp ? 0 : Math.PI, 0);
          inst.baseScale = count <= 4 ? 1.12 : 0.94;

          // Update border & glow aura
          if (isStorytellerTrueCard) {
            inst.borderMat.color.setHex(0xf4b942);
            inst.glowMat.color.setHex(0xf4b942);
            inst.glowMat.opacity = 0.55;
          } else if (isSelectedVote) {
            inst.borderMat.color.setHex(0xe07a5f);
            inst.glowMat.color.setHex(0xe07a5f);
            inst.glowMat.opacity = 0.45;
          } else {
            inst.borderMat.color.setHex(0xf4efe9);
            inst.glowMat.opacity = 0.0;
          }
        });
      }

      // If a card is currently enlarged for 3D Inspection (from hand or table)
      // Scaled down viewport footprint for a refined, balanced perspective
      if (isInspecting && st.inspectedCardId) {
        const key = 'inspected_focus';
        activeKeys.add(key);
        const inst = getOrCreateCardInstance(key, st.inspectedCardId, false);
        inst.basePos.set(0, -0.8, 2.2);
        inst.baseRot.set(0.08, 0, 0);
        inst.baseScale = 1.08;
        inst.borderMat.color.setHex(0xf4efe9);
        inst.glowMat.opacity = 0;
      }

      // Remove unused card instances cleanly
      for (const [key, inst] of cardInstances.entries()) {
        if (!activeKeys.has(key)) {
          cardsRoot.remove(inst.group);
          inst.frontMat.dispose();
          inst.borderMat.dispose();
          inst.glowMat.dispose();
          cardInstances.delete(key);
        }
      }
    }

    syncCardsTriggerRef.current = syncSceneCards;
    syncSceneCards();

    // Pointer Drag / Hold-to-Tilt state for glossy specular inspection
    let isPointerDown = false;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let pointerMovedDistance = 0;
    let tiltTargetX = 0;
    let tiltTargetY = 0;
    let hoveredKey: string | null = null;

    const raycaster = new THREE.Raycaster();

    function updatePointerNDC(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      _mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(e: PointerEvent) {
      updatePointerNDC(e.clientX, e.clientY);
      isPointerDown = true;
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      pointerMovedDistance = 0;
      if (stateRef.current.inspectedCardId) {
        setIsDraggingTilt(true);
      }
    }

    function onPointerMove(e: PointerEvent) {
      updatePointerNDC(e.clientX, e.clientY);
      if (isPointerDown) {
        const dx = e.clientX - pointerStartX;
        const dy = e.clientY - pointerStartY;
        pointerMovedDistance = Math.hypot(dx, dy);

        // Hold-and-drag 3D card tilt (-0.52 rad to +0.52 rad)
        tiltTargetY = THREE.MathUtils.clamp(dx * 0.0065, -0.55, 0.55);
        tiltTargetX = THREE.MathUtils.clamp(dy * 0.0065, -0.45, 0.45);
      } else {
        // Subtle ambient hover parallax
        tiltTargetY = _mouseNDC.x * 0.18;
        tiltTargetX = -_mouseNDC.y * 0.14;

        // Raycast table cards for hover feedback
        const meshes: THREE.Object3D[] = [];
        for (const inst of cardInstances.values()) {
          meshes.push(inst.frontMesh);
        }
        raycaster.setFromCamera(_mouseNDC, camera);
        const hits = raycaster.intersectObjects(meshes, false);
        const hitKey = hits[0]?.object?.userData?.instanceKey || null;
        if (hitKey !== hoveredKey) {
          hoveredKey = hitKey;
          renderer.domElement.style.cursor = hitKey ? 'pointer' : 'default';
          if (hitKey) soundEngine.playHover();
        }
      }
    }

    function onPointerUp() {
      isPointerDown = false;
      setIsDraggingTilt(false);

      if (pointerMovedDistance < 8) {
        // Treat as a click!
        const meshes: THREE.Object3D[] = [];
        for (const inst of cardInstances.values()) {
          meshes.push(inst.frontMesh);
        }
        raycaster.setFromCamera(_mouseNDC, camera);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const clickedCardId = hits[0].object.userData?.cardId;
          const clickedKey = hits[0].object.userData?.instanceKey;
          const st = stateRef.current;

          if (st.inspectedCardId && clickedKey !== 'inspected_focus') {
            return;
          }

          if (st.phase === 'VOTING' && clickedCardId) {
            if (clickedCardId === st.yourSubmittedCardId) {
              // Self-vote blocked
              return;
            }
            soundEngine.playCardSelect();
            st.onSelectVoteCard(clickedCardId);
          }
        }
      }

      tiltTargetX = 0;
      tiltTargetY = 0;
    }

    const domElem = renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    function onResize() {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 4. Render Loop with Software WebGL Fence Pacing & Smooth Exponential Damping
    const clock = new THREE.Clock();
    let frameId = 0;
    let isDisposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (isDisposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      for (const [key, inst] of cardInstances.entries()) {
        const isFocus = key === 'inspected_focus';
        const isHovered = key === hoveredKey && !stateRef.current.inspectedCardId;

        _targetPos.copy(inst.basePos);
        if (isHovered) {
          _targetPos.y += 0.14;
          _targetPos.z += 0.25;
        }
        // Subtle floating breath motion
        _targetPos.y += Math.sin(elapsed * 2.1 + inst.basePos.x) * 0.035;

        inst.group.position.x = THREE.MathUtils.damp(inst.group.position.x, _targetPos.x, 9, delta);
        inst.group.position.y = THREE.MathUtils.damp(inst.group.position.y, _targetPos.y, 9, delta);
        inst.group.position.z = THREE.MathUtils.damp(inst.group.position.z, _targetPos.z, 9, delta);

        const targetScaleScalar = isHovered ? inst.baseScale * 1.05 : inst.baseScale;
        _targetScale.setScalar(targetScaleScalar);
        inst.group.scale.x = THREE.MathUtils.damp(inst.group.scale.x, _targetScale.x, 10, delta);
        inst.group.scale.y = THREE.MathUtils.damp(inst.group.scale.y, _targetScale.y, 10, delta);
        inst.group.scale.z = THREE.MathUtils.damp(inst.group.scale.z, _targetScale.z, 10, delta);

        // Apply hold-and-drag glossy tilt on focus card or hovered card
        const rotX = isFocus || isHovered ? inst.baseRot.x + tiltTargetX : inst.baseRot.x;
        const rotY = isFocus || isHovered ? inst.baseRot.y + tiltTargetY : inst.baseRot.y;

        inst.group.rotation.x = THREE.MathUtils.damp(inst.group.rotation.x, rotX, 11, delta);
        inst.group.rotation.y = THREE.MathUtils.damp(inst.group.rotation.y, rotY, 9, delta);

        // Keep the subtle card wash extremely restrained; no central glare point light.
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      domElem.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);

      extrudeGeo.dispose();
      facePlaneGeo.dispose();
      glowPlaneGeo.dispose();
      tableGeo.dispose();
      tableMat.dispose();
      tableRimGeo.dispose();
      tableRimMat.dispose();
      cardBackTex.dispose();
      backMat.dispose();
      for (const tex of textureCache.values()) tex.dispose();
      for (const inst of cardInstances.values()) {
        inst.frontMat.dispose();
        inst.borderMat.dispose();
        inst.glowMat.dispose();
      }
      renderer.dispose();
    };
  }, []);

  const inspectedCardMeta = inspectedCardId
    ? cardsPool.find((c) => c.id === inspectedCardId)
    : null;

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Dedicated isolated WebGL Canvas Mount */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Semantic Overlay for Scoring Phase Voter Badges */}
      {phase === 'SCORING' && revealedCards.length > 0 && (
        <div className="absolute inset-0 p-3 sm:p-5 z-10">
          <div className="neo-surface rounded-2xl p-4 sm:p-6 w-full h-full overflow-y-auto">
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {revealedCards.map((entry) => {
              const cardMeta = cardsPool.find((c) => c.id === entry.cardId);
              const owner = players.find((p) => p.id === entry.ownerId);
              const isStorytellerCard = entry.cardId === storytellerCardId;
              const voters = entry.voterIds
                .map((vid) => players.find((p) => p.id === vid))
                .filter(Boolean) as Player[];

              return (
                <div
                  key={entry.cardId}
                  className={`min-w-0 flex flex-col gap-3 p-3 rounded-xl border ${
                    isStorytellerCard
                      ? 'bg-[#fdf1d4] border-[#d49a3a]'
                      : 'bg-[#f4efe9] border-white/80'
                  }`}
                >
                  <img
                    src={cardMeta?.url}
                    alt={cardMeta ? `Card #${String(cardMeta.number).padStart(3, '0')}` : 'Card'}
                    referrerPolicy="no-referrer"
                    className="w-full aspect-[2/3] object-contain rounded-lg shadow-sm bg-[#ebe5de]"
                  />
                  <div className="text-left">
                    <div className="text-xs font-semibold text-[#2b303a] flex flex-wrap items-center gap-1.5 break-words">
                      <span className="min-w-0 break-all">{owner?.nickname || 'Player'}</span>
                      <span>·</span>
                      <span className={isStorytellerCard ? 'text-[#b57c1e] font-bold' : 'text-[#5e6472]'}>
                        {isStorytellerCard ? 'Storyteller Card' : 'Decoy'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {voters.length === 0 ? (
                        <span className="text-[11px] text-[#5e6472]">No votes</span>
                      ) : (
                        voters.map((v) => (
                          <div
                            key={v.id}
                            className="flex min-w-0 max-w-full items-center gap-1 bg-white/80 px-1.5 py-0.5 rounded-md"
                          >
                            <img
                              src={v.avatarUrl}
                              alt={v.nickname}
                              className="w-4 h-4 shrink-0 rounded-full"
                            />
                            <span className="text-[11px] font-medium text-[#2b303a] break-all">
                              {v.nickname}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
