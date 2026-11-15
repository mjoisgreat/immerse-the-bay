// app/stage.js: the shared stage (leaf module: imports only three). DOM helpers, renderer, scene, camera, listener, lights.
import * as THREE from "three";

export const $ = (s) => document.querySelector(s);
const statusEl = $("#status");
export const say = (t) => (statusEl.textContent = t);

// ---------- Scene ----------
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 0);
scene.add(camera);
export const listener = new THREE.AudioListener();
camera.add(listener);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));
// Key and rim light so the companion reads clearly against a dim room.
const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.8);
keyLight.position.set(1.5, 3, 2);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9cc3ff, 1.2);
rimLight.position.set(-2, 2, -3);
scene.add(rimLight);

// Desktop preview room (hidden in mixed reality, where the real room shows through).
export const previewRoom = new THREE.Group();
previewRoom.add(new THREE.GridHelper(20, 40, 0x334466, 0x1c2233));
scene.add(previewRoom);
export const DESKTOP_BG = new THREE.Color(0x0b0e16);
scene.background = DESKTOP_BG;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
