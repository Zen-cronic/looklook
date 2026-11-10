"use client";

import { ContactShadows, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * The toy shelf, in real 3D: one floating shelf square to the camera with a
 * row of clay-white products. A new bottle drops in from above and hovers
 * without finding a slot, its twin on the shelf turns cobalt, and a dotted
 * line draws between them. Everything stays upright.
 *
 * `mode` "play" runs the sequence once and then stops rendering; "initial"
 * and "final" draw one frame of the first or last state (used to render the
 * still images the page shows before and instead of this canvas).
 */
export type ShelfMode = "play" | "initial" | "final";

const COBALT = new THREE.Color("#2B3BFF");
// Lit clay adds white, so the surface colour sits darker and the glow brings it back to the brand cobalt.
const COBALT_SURFACE = new THREE.Color("#1622C8");
const CLAY = new THREE.Color("#F3F2EE");
const CLAY_LID = new THREE.Color("#E8E7E2");
const INK = new THREE.Color("#0A0A0A");

// Timeline, in seconds after the first frame.
const T = { hold: 0.25, glow: [0.75, 1.1], line: [1.1, 1.7], done: 1.75, end: 2.0 } as const;

type Kind = "bottle" | "jar" | "tube" | "dropper";
const ITEMS: { kind: Kind; x: number; twin?: boolean }[] = [
  { kind: "tube", x: -3.2 },
  { kind: "jar", x: -2.2 },
  { kind: "dropper", x: -1.2 },
  { kind: "bottle", x: -0.15, twin: true },
  { kind: "tube", x: 0.9 },
  { kind: "jar", x: 1.95 },
  { kind: "dropper", x: 3.0 },
];
const TWIN_X = -0.15;
const HOVER = { x: 1.5, y: 2.0 };
const SHELF = { w: 7.7, h: 0.24, d: 1.4 };
const WALL_Z = -SHELF.d / 2 - 0.01;
const BOTTLE_H = 1.46;

/** Framing: the whole shelf on a wide stage; on a narrow one, four to five items centred on the match. */
function framing(aspect: number) {
  const narrow = aspect < 1.25;
  const width = narrow ? 5.5 : 8.15;
  const cx = narrow ? (TWIN_X + HOVER.x) / 2 + 0.05 : 0;
  const cy = narrow ? 1.3 : 1.35;
  return { width, cx, cy };
}

function CameraRig() {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const { camera: cam, invalidate } = get();
    const camera = cam as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const { width, cx, cy } = framing(aspect);
    const fov = 20;
    const visH = width / aspect;
    const dist = visH / 2 / Math.tan((fov * Math.PI) / 360);
    camera.fov = fov;
    camera.near = 1;
    camera.far = 80;
    camera.position.set(cx, cy + dist * 0.09, dist);
    camera.lookAt(cx, cy, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [get, size]);
  return null;
}

// Lathe profiles: rounded edges everywhere, so the clay reads soft.
function roundedCylinder(r: number, h: number, b: number, seg = 6) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - b + b * Math.cos(a), b + b * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - b + b * Math.cos(a), h - b + b * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, 48);
}

function bottleBody(r: number, body: number, shoulder: number, neck: number, neckH: number, b = 0.07, seg = 10) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - b + b * Math.cos(a), b + b * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(neck + (r - neck) * Math.cos(a), body - shoulder + shoulder * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(neck, body + neckH));
  pts.push(new THREE.Vector2(0, body + neckH));
  return new THREE.LatheGeometry(pts, 48);
}

/** A squeeze tube standing on its cap: round at the cap, flat at the crimp. */
function tubeBody(h: number) {
  const g = new THREE.CylinderGeometry(1, 1, h, 48, 24, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h;
    const sx = 0.25 + 0.1 * Math.sin((t * Math.PI) / 2);
    const sz = 0.23 - 0.185 * Math.pow(t, 1.15);
    p.setXYZ(i, p.getX(i) * sx, p.getY(i) + h / 2, p.getZ(i) * sz);
  }
  g.computeVertexNormals();
  return g;
}

function useGeometries() {
  return useMemo(
    () => ({
      bottle: bottleBody(0.4, 1.04, 0.24, 0.14, 0.1),
      bottleCap: roundedCylinder(0.17, 0.32, 0.05),
      jar: roundedCylinder(0.46, 0.44, 0.09),
      jarLid: roundedCylinder(0.48, 0.21, 0.07),
      dropper: bottleBody(0.3, 0.66, 0.16, 0.11, 0.06, 0.06),
      collar: roundedCylinder(0.135, 0.17, 0.045),
      bulb: new THREE.CapsuleGeometry(0.1, 0.16, 8, 24),
      tubeCap: roundedCylinder(0.18, 0.26, 0.05),
      tubeShoulder: roundedCylinder(0.25, 0.1, 0.05),
      tube: tubeBody(1.18),
      dot: new THREE.SphereGeometry(0.034, 16, 12),
    }),
    [],
  );
}

type Geo = ReturnType<typeof useGeometries>;

function Product({ kind, geo, body, lid }: { kind: Kind; geo: Geo; body: THREE.Material; lid: THREE.Material }) {
  switch (kind) {
    case "bottle":
      return (
        <group>
          <mesh geometry={geo.bottle} material={body} castShadow />
          <mesh geometry={geo.bottleCap} material={lid} position-y={1.12} castShadow />
        </group>
      );
    case "jar":
      return (
        <group>
          <mesh geometry={geo.jar} material={body} castShadow />
          <mesh geometry={geo.jarLid} material={lid} position-y={0.43} castShadow />
        </group>
      );
    case "dropper":
      return (
        <group>
          <mesh geometry={geo.dropper} material={body} castShadow />
          <mesh geometry={geo.collar} material={lid} position-y={0.7} castShadow />
          <mesh geometry={geo.bulb} material={lid} position-y={1.0} castShadow />
        </group>
      );
    case "tube":
      return (
        <group>
          <mesh geometry={geo.tubeCap} material={lid} castShadow />
          <mesh geometry={geo.tubeShoulder} material={body} position-y={0.24} castShadow />
          <mesh geometry={geo.tube} material={body} position-y={0.3} castShadow />
          <RoundedBox args={[0.72, 0.09, 0.1]} radius={0.03} smoothness={3} position-y={1.5} material={body} castShadow />
        </group>
      );
  }
}

/** Damped spring from `from` to 0 over time t (s): settles in about half a second. */
function spring(t: number, from: number) {
  if (t <= 0) return from;
  if (t > 1.2) return 0;
  const w = 14;
  const z = 0.62;
  const wd = w * Math.sqrt(1 - z * z);
  return from * Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
const span = (t: number, [a, b]: readonly [number, number]) => ease((t - a) / (b - a));

/** The dotted line from the hovering bottle down to its twin: real dots, drawn one after another. */
function connectorPoints(n: number) {
  const from = new THREE.Vector3(HOVER.x - 0.5, HOVER.y + 0.42, 0.15);
  const to = new THREE.Vector3(TWIN_X + 0.3, BOTTLE_H + 0.06, 0.15);
  const ctrl = new THREE.Vector3((from.x + to.x) / 2 + 0.1, Math.max(from.y, to.y) + 0.35, 0.15);
  const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
  return curve.getSpacedPoints(n - 1);
}

function Shelf({ mode, onDone }: { mode: ShelfMode; onDone?: () => void }) {
  const geo = useGeometries();
  const invalidate = useThree((s) => s.invalidate);
  const mats = useMemo(() => {
    const clay = new THREE.MeshPhysicalMaterial({ color: CLAY, roughness: 0.9, metalness: 0, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color("#FFFFFF") });
    const lid = clay.clone();
    lid.color.copy(CLAY_LID);
    // The twin loses the white sheen, so its cobalt stays the brand colour.
    const twin = clay.clone();
    twin.sheen = 0;
    const twinLid = lid.clone();
    twinLid.sheen = 0;
    const dot = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 });
    return { clay, lid, twin, twinLid, dot };
  }, []);
  const dots = useMemo(() => connectorPoints(17), []);
  const hover = useRef<THREE.Group>(null);
  const dotRefs = useRef<(THREE.Mesh | null)[]>([]);
  const start = useRef<number | null>(null);
  const finished = useRef(false);

  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const t = mode === "final" ? 99 : mode === "initial" ? -1 : clock.elapsedTime - start.current - T.hold;
    // The new bottle: drops from above the frame and stays upright.
    if (hover.current) {
      hover.current.visible = t >= 0;
      hover.current.position.y = HOVER.y + spring(t, 4.6);
    }
    // Its twin turns cobalt.
    const g = mode === "final" ? 1 : mode === "initial" ? 0 : span(t, T.glow);
    mats.twin.color.copy(CLAY).lerp(COBALT_SURFACE, g);
    mats.twin.emissive.copy(COBALT).multiplyScalar(0.3 * g);
    mats.twinLid.color.copy(CLAY_LID).lerp(COBALT_SURFACE, g);
    mats.twinLid.emissive.copy(COBALT).multiplyScalar(0.26 * g);
    // The dotted line draws from the new bottle to the twin.
    const l = mode === "final" ? 1 : mode === "initial" ? 0 : span(t, T.line);
    dotRefs.current.forEach((m, i) => {
      if (!m) return;
      const k = Math.min(1, Math.max(0, l * dots.length - i));
      m.visible = k > 0;
      m.scale.setScalar(k);
    });
    if (mode !== "play") return;
    if (t >= T.done && !finished.current) {
      finished.current = true;
      onDone?.();
    }
    if (t < T.end) invalidate();
  });

  return (
    <group>
      <RoundedBox args={[SHELF.w, SHELF.h, SHELF.d]} radius={0.07} smoothness={4} position={[0, -SHELF.h / 2, 0]} material={mats.clay} castShadow receiveShadow />
      {ITEMS.map((it) => (
        <group key={it.x} position={[it.x, 0, 0.05]}>
          <Product kind={it.kind} geo={geo} body={it.twin ? mats.twin : mats.clay} lid={it.twin ? mats.twinLid : mats.lid} />
        </group>
      ))}
      <group ref={hover} position={[HOVER.x, HOVER.y + 4.6, 0.05]} visible={false}>
        <Product kind="bottle" geo={geo} body={mats.clay} lid={mats.lid} />
      </group>
      {dots.map((p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            dotRefs.current[i] = m;
          }}
          geometry={geo.dot}
          material={mats.dot}
          position={p}
          visible={false}
        />
      ))}
      <ContactShadows position={[0, 0.003, 0.05]} scale={[SHELF.w, SHELF.d]} resolution={512} blur={2.2} far={2.6} opacity={0.42} color="#0A0A0A" />
      <mesh position={[0, 1.2, WALL_Z]} receiveShadow>
        <planeGeometry args={[40, 24]} />
        <shadowMaterial transparent opacity={0.075} color="#0A0A0A" />
      </mesh>
    </group>
  );
}

export default function ToyShelfScene({ mode, onReady, onDone }: { mode: ShelfMode; onReady?: () => void; onDone?: () => void }) {
  return (
    <Canvas
      frameloop="demand"
      flat
      shadows="variance"
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      camera={{ fov: 20, position: [0, 2, 16] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
      }}
      aria-hidden="true"
    >
      <CameraRig />
      <hemisphereLight args={["#FFFFFF", "#D9D8D3", 1.25]} />
      <directionalLight
        position={[-2.2, 5.2, 9]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-radius={18}
        shadow-blurSamples={25}
        shadow-bias={-0.0004}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-5}
        shadow-camera-near={1}
        shadow-camera-far={30}
      />
      <directionalLight position={[5, 2.5, 7]} intensity={0.55} />
      <Shelf mode={mode} onDone={onDone} />
    </Canvas>
  );
}
