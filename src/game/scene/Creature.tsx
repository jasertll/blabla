"use client";

import { use, useEffect, useMemo } from "react";
import * as THREE from "three";
import { loadGLTF } from "../assets";
import { clone, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

// A faceless, armless figure built on a rigged human body (Mixamo skeleton).
// The arms are collapsed into the shoulders so the skin reads as one wrapped
// mass, the upper body hangs in a slumped pose, and the neck and head jerk.

export const CREATURE_URL = "models/creature.glb";

const UPPER = /Spine|Neck|Head|Shoulder|Arm|Hand/;

export function useCreature(skin: THREE.Material) {
  const gltf = use(loadGLTF(CREATURE_URL));

  const rig = useMemo(() => {
    const model = clone(gltf.scene);
    model.scale.setScalar(1.08);
    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = skin;
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => gltf.animations.find((a) => a.name === n)!;
    const walk = mixer.clipAction(clip("walk"));
    const idle = mixer.clipAction(clip("idle"));
    // slumped upper body layered over the legs
    const sad = clip("sad_pose").clone();
    sad.tracks = sad.tracks.filter((t) => UPPER.test(t.name.split(".")[0]));
    const slump = mixer.clipAction(sad);
    walk.play();
    idle.play();
    slump.play();
    walk.setEffectiveTimeScale(0.55);
    slump.setEffectiveWeight(1);
    return { model, mixer, bones, walk, idle };
  }, [gltf, skin]);

  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
    },
    [rig],
  );

  const jerk = useMemo(() => new THREE.Euler(), []);

  const update = (dt: number, speed: number, spasm: boolean, t: number) => {
    const w = Math.min(1, speed / 0.5);
    rig.walk.setEffectiveWeight(w);
    rig.idle.setEffectiveWeight(1 - w);
    rig.walk.setEffectiveTimeScale(0.35 + speed * 0.45);
    rig.mixer.update(dt);

    const b = rig.bones;
    // arms gone: folded into the torso
    for (const n of ["mixamorigLeftArm", "mixamorigRightArm"]) b[n]?.scale.setScalar(0.001);
    for (const n of ["mixamorigLeftShoulder", "mixamorigRightShoulder"]) b[n]?.scale.set(0.55, 0.55, 0.55);
    // a slow wrongness in the neck, and violent jerks when it spasms
    const k = spasm ? 1 : 0;
    jerk.set(
      Math.sin(t * 1.3) * 0.12 + k * (Math.random() - 0.5) * 0.9,
      Math.sin(t * 0.7) * 0.2 + k * (Math.random() - 0.5) * 1.2,
      Math.sin(t * 2.1) * 0.1 + k * (Math.random() - 0.5) * 0.8,
    );
    b.mixamorigNeck?.rotation.set(b.mixamorigNeck.rotation.x + jerk.x * 0.5, b.mixamorigNeck.rotation.y + jerk.y * 0.5, b.mixamorigNeck.rotation.z + jerk.z * 0.5);
    b.mixamorigHead?.rotation.set(b.mixamorigHead.rotation.x - 0.35 + jerk.x, b.mixamorigHead.rotation.y + jerk.y, b.mixamorigHead.rotation.z + jerk.z);
    b.mixamorigSpine2?.rotation.set(b.mixamorigSpine2.rotation.x + k * (Math.random() - 0.5) * 0.4, b.mixamorigSpine2.rotation.y, b.mixamorigSpine2.rotation.z + Math.sin(t * 1.9) * 0.08);
  };

  return { model: rig.model, update };
}

// ------------------------------------------------------------------ the stalker

/** Grey-blue skin with dark veins and pores, computed from bind-pose position
 *  (the model has no texture coordinates to paint on). */
export function stalkerSkin() {
  const m = new THREE.MeshStandardMaterial({ color: "#56616b", roughness: 0.62, metalness: 0, transparent: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vBind;
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  vec3 q = vBind * 22.0;
  float veins = smoothstep(0.47, 0.5, n3(q)) * smoothstep(0.53, 0.5, n3(q));
  float blotch = n3(vBind * 6.0);
  float pores = h3(floor(vBind * 400.0));
  diffuseColor.rgb *= 0.75 + blotch * 0.45;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.06, 0.09), veins * 0.85);
  diffuseColor.rgb *= 0.92 + pores * 0.12;`,
      );
  };
  return m;
}

const eyeMat = new THREE.MeshStandardMaterial({ color: "#300", emissive: "#ff2a12", emissiveIntensity: 4 });
const mouthMat = new THREE.MeshStandardMaterial({ color: "#120606", roughness: 0.4 });
const toothMat = new THREE.MeshStandardMaterial({ color: "#cfc3a3", roughness: 0.35 });

/** Tall, gaunt, long-armed. Lurches after you and freezes in the light. */
export function useStalker(skin: THREE.Material) {
  const gltf = use(loadGLTF(CREATURE_URL));

  const rig = useMemo(() => {
    const model = clone(gltf.scene);
    model.scale.setScalar(1.14);
    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = skin;
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    // face: two burning eyes and a split grin full of teeth (bone space is centimetres)
    const head = bones.mixamorigHead;
    if (head) {
      for (const x of [-3.1, 3.1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 10), eyeMat);
        e.position.set(x, 10.5, 8.2);
        head.add(e);
      }
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.6, 2), mouthMat);
      mouth.position.set(0, 4.2, 8.6);
      head.add(mouth);
      for (let i = 0; i < 11; i++) {
        for (const top of [1, -1]) {
          const t = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5 + Math.random() * 0.6, 5), toothMat);
          t.position.set(-3.8 + i * 0.76, 4.2 + top * 0.9, 9.5);
          t.rotation.z = top > 0 ? Math.PI : 0;
          head.add(t);
        }
      }
    }
    const mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => gltf.animations.find((a) => a.name === n)!;
    const walk = mixer.clipAction(clip("walk"));
    const idle = mixer.clipAction(clip("idle"));
    walk.play();
    idle.play();
    return { model, mixer, bones, walk, idle };
  }, [gltf, skin]);

  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
    },
    [rig],
  );

  const update = (dt: number, speed: number, frozen: boolean, t: number) => {
    const w = Math.min(1, speed / 0.6);
    rig.walk.setEffectiveWeight(w);
    rig.idle.setEffectiveWeight(1 - w);
    rig.walk.setEffectiveTimeScale(0.45 + speed * 0.35);
    rig.mixer.update(frozen ? 0 : dt);
    const b = rig.bones;
    // lanky: long thin arms, thin legs, a forward hunch
    for (const n of ["mixamorigLeftArm", "mixamorigRightArm"]) b[n]?.scale.set(0.72, 1.32, 0.72);
    for (const n of ["mixamorigLeftUpLeg", "mixamorigRightUpLeg"]) b[n]?.scale.set(0.74, 1.06, 0.74);
    for (const n of ["mixamorigSpine1", "mixamorigSpine2"]) b[n]?.scale.set(0.84, 1.05, 0.84);
    if (b.mixamorigSpine1) b.mixamorigSpine1.rotation.x += 0.28;
    if (b.mixamorigNeck) b.mixamorigNeck.rotation.x += 0.35;
    if (b.mixamorigHead) {
      b.mixamorigHead.rotation.x -= 0.45;
      // the head never quite sits still
      b.mixamorigHead.rotation.z += Math.sin(t * 7.3) * 0.04 + (Math.random() < 0.02 ? (Math.random() - 0.5) * 0.6 : 0);
    }
  };

  return { model: rig.model, update };
}

// ------------------------------------------------------------------ Elena

export const ELENA_URL = "models/elena.glb";

/** Elena: a rigged woman, driven by the creature file's motion (same Mixamo
 *  skeleton; rotations only, so proportions stay hers). Materials are cloned
 *  and transparent so she can fade. */
export function useElena(clips: string[] = ["idle"]) {
  const body = use(loadGLTF(ELENA_URL));
  const moves = use(loadGLTF(CREATURE_URL));
  const rig = useMemo(() => {
    const model = clone(body.scene);
    const mats: THREE.MeshStandardMaterial[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.transparent = true;
        mat.roughness = 0.85;
        // drained of colour: a photograph left in the sun
        mat.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace(
            "#include <map_fragment>",
            "#include <map_fragment>\n  float g = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g) * vec3(0.86, 0.92, 0.9), 0.85);",
          );
        };
        m.material = mat;
        mats.push(mat);
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    });
    // Pose her from the bind (T) pose by aiming limbs in model space: arms
    // hanging, elbows soft, head bowed. Breathing is added per frame.
    model.updateMatrixWorld(true);
    const aim = (bone?: THREE.Bone, child?: THREE.Object3D, dir?: THREE.Vector3) => {
      if (!bone || !child || !dir) return;
      const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      const b = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
      const cur = b.sub(a).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parent.invert().multiply(delta.multiply(world)));
      bone.updateMatrixWorld(true);
    };
    const B = bones;
    aim(B.mixamorigLeftArm, B.mixamorigLeftForeArm, new THREE.Vector3(0.16, -1, 0.06));
    aim(B.mixamorigRightArm, B.mixamorigRightForeArm, new THREE.Vector3(-0.16, -1, 0.06));
    aim(B.mixamorigLeftForeArm, B.mixamorigLeftHand, new THREE.Vector3(0.08, -1, 0.22));
    aim(B.mixamorigRightForeArm, B.mixamorigRightHand, new THREE.Vector3(-0.08, -1, 0.22));
    aim(B.mixamorigHead, B.mixamorigHeadTop_End, new THREE.Vector3(0, 0.82, 0.55));
    const rest: Record<string, THREE.Quaternion> = {};
    for (const [n, b] of Object.entries(B)) rest[n] = b.quaternion.clone();
    const mixer = new THREE.AnimationMixer(model);
    void clips;
    return { model, mixer, mats, bones, rest };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, moves]);
  useEffect(() => () => void rig.mixer.stopAllAction(), [rig]);
  /** Reset to her pose; callers then add their own small motions. */
  const breathe = (t: number) => {
    for (const [n, q] of Object.entries(rig.rest)) rig.bones[n].quaternion.copy(q);
    const s = Math.sin(t * 1.6);
    rig.bones.mixamorigSpine1?.rotateX(s * 0.015);
    rig.bones.mixamorigLeftShoulder?.rotateZ(s * 0.01);
    rig.bones.mixamorigRightShoulder?.rotateZ(-s * 0.01);
  };
  const setOpacity = (v: number) => {
    for (const m of rig.mats) m.opacity = v;
    rig.model.visible = v > 0.02;
  };
  return { ...rig, setOpacity, breathe };
}
