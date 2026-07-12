import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?module";

let scene, camera, renderer;
let playerCar, carModel;
let trafficCars = [];
let roadLines = [];
let score = 0;
let speed = 0.45;
let gameStarted = false;
let gameOver = false;

const keys = {};
const lanes = [-5, -2.5, 0, 2.5, 5];

init();
loadCar();
animate();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 7, 13);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 15, 10);
  scene.add(sun);

  createRoad();

  window.addEventListener("keydown", e => {
    keys[e.code] = true;

    if (e.code === "Space" && !gameStarted) {
      gameStarted = true;
      document.getElementById("message").style.display = "none";
    }

    if (e.code === "Space" && gameOver) location.reload();
  });

  window.addEventListener("keyup", e => keys[e.code] = false);
  window.addEventListener("resize", resize);
}

function loadCar() {
  const loader = new GLTFLoader();

  loader.load(
    "images/car.glb",
    gltf => {
      carModel = gltf.scene;
      carModel.scale.set(0.8, 0.8, 0.8);

      createPlayerCar();
      createTrafficCars();
      console.log("Voiture chargée");
    },
    xhr => {
      console.log("Chargement voiture...");
    },
    error => {
      console.error("Erreur GLB :", error);
      document.getElementById("message").innerHTML =
        "Erreur : images/car.glb non trouvé ou invalide";

      createFallbackCars();
    }
  );
}

function createRoad() {
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 600),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.z = -160;
  scene.add(grass);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 600),
    new THREE.MeshStandardMaterial({ color: 0x2f2f2f })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.position.z = -160;
  scene.add(road);

  for (let i = 0; i < 90; i++) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.04, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    line.position.set(0, 0.08, -i * 7);
    scene.add(line);
    roadLines.push(line);
  }
}

function createPlayerCar() {
  playerCar = cloneCar();
  playerCar.position.set(0, 0.2, 5);
  playerCar.rotation.y = Math.PI;
  scene.add(playerCar);
}

function createTrafficCars() {
  for (let i = 0; i < 12; i++) {
    const car = cloneCar();
    car.position.set(randomLane(), 0.2, -30 - i * 25);
    car.rotation.y = Math.PI;
    car.userData.speed = 0.2 + Math.random() * 0.3;
    scene.add(car);
    trafficCars.push(car);
  }
}

function cloneCar() {
  const clone = carModel.clone(true);

  clone.traverse(child => {
    if (child.isMesh && child.material) {
      child.material = child.material.clone();
    }
  });

  return clone;
}

function createFallbackCars() {
  playerCar = createSimpleCar(0xff0000);
  playerCar.position.set(0, 0.5, 5);
  scene.add(playerCar);

  for (let i = 0; i < 10; i++) {
    const car = createSimpleCar(0x0066ff);
    car.position.set(randomLane(), 0.5, -30 - i * 25);
    car.userData.speed = 0.2;
    scene.add(car);
    trafficCars.push(car);
  }
}

function createSimpleCar(color) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.6, 4),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.5;
  car.add(body);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.6, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x111111 })
  );
  top.position.y = 1.1;
  car.add(top);

  return car;
}

function animate() {
  requestAnimationFrame(animate);

  if (gameStarted && !gameOver && playerCar) {
    updateGame();
  }

  renderer.render(scene, camera);
}

function updateGame() {
  score++;

  if (keys["ArrowUp"] || keys["KeyW"]) speed = Math.min(speed + 0.01, 1.2);
  else speed = Math.max(speed - 0.004, 0.45);

  if (keys["ArrowLeft"] || keys["KeyA"]) playerCar.position.x -= 0.17;
  if (keys["ArrowRight"] || keys["KeyD"]) playerCar.position.x += 0.17;

  playerCar.position.x = THREE.MathUtils.clamp(playerCar.position.x, -6, 6);

  roadLines.forEach(line => {
    line.position.z += speed * 3.4;
    if (line.position.z > 20) line.position.z -= 630;
  });

  trafficCars.forEach(car => {
    car.position.z += speed * 3.4 - car.userData.speed;

    if (car.position.z > 18) {
      car.position.z = -300;
      car.position.x = randomLane();
    }

    if (collision(playerCar, car)) endGame();
  });

  camera.position.x += (playerCar.position.x - camera.position.x) * 0.08;
  camera.position.z = playerCar.position.z + 13;
  camera.lookAt(playerCar.position.x, 1.5, playerCar.position.z - 12);

  document.getElementById("score").innerText = score;
  document.getElementById("speed").innerText = Math.floor(speed * 190);
}

function collision(a, b) {
  return Math.abs(a.position.x - b.position.x) < 1.7 &&
         Math.abs(a.position.z - b.position.z) < 3.5;
}

function randomLane() {
  return lanes[Math.floor(Math.random() * lanes.length)];
}

function endGame() {
  gameOver = true;
  document.getElementById("message").style.display = "block";
  document.getElementById("message").innerHTML =
    "GAME OVER<br>Score : " + score + "<br>Appuie sur ESPACE pour recommencer";
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}