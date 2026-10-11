"use client";

import { use, useEffect, useMemo } from "react";
import * as THREE from "three";
import { loadGLTF } from "../assets";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

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
