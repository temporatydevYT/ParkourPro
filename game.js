import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

export class Game {
  constructor(scene, camera, renderer, config = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.clock = new THREE.Clock();

    // grab values from the level config, or fall back to sensible defaults
    this.GRAVITY = config.gravity || 38;
    this.JUMP_FORCE = config.jumpForce || 16;
    this.BOB_STRENGTH = config.bobStrength || 0.04;
    this.BOB_SPEED = config.bobSpeed || 17;
    this.NUM_SPHERES = config.ballLimit || 100;
    this.SPHERE_RADIUS = 0.2;
    this.STEPS_PER_FRAME = 5;
    this.playerSpeed = config.playerSpeed || 95;
    this.airControl = config.airControl || 18;
    this.throwCooldown = 1.0;
    this.throwTimer = 0;
    this.ballsThrown = 0;

    this.config = config;
    this.useBalls = config.useBalls !== undefined ? config.useBalls : true;
    this.levelNumber = config.levelNumber || 1;

    // where the player is looking when they first spawn
    const initialRotationY = config.playerLookAt?.rotationY || 0;
    const initialRotationX = config.playerLookAt?.rotationX || 0;
    this.camera.rotation.set(initialRotationX, initialRotationY, 0);

    // timer stuff — startTime is null until the player first moves
    this.startTime = null;
    this.pausedTime = 0; // how long we've spent paused in total
    this.pauseStartTime = null; // when the current pause began
    this.completionTime = null; // locked in when the level ends
    this.levelCompleted = false;
    
    this.deathCount = 0;

    this.worldOctree = new Octree();
    this.playerCollider = new Capsule(
      new THREE.Vector3(0, 0.35, 0),
      new THREE.Vector3(0, 1.55, 0),
      0.18
    );

    this.bobTime = 0;

    this.playerVelocity = new THREE.Vector3();
    this.playerDirection = new THREE.Vector3();
    this.playerOnFloor = false;
    this.mouseTime = 0;
    this.keyStates = {};

    this.vector1 = new THREE.Vector3();
    this.vector2 = new THREE.Vector3();
    this.vector3 = new THREE.Vector3();

    this.joystickDX = 0;
    this.joystickDY = 0;

    this.spheres = [];
    this.sphereIdx = 0;
    this.shockwaves = [];

    this.isPaused = false;

    // Load sensitivity from localStorage or default to 1.0
    this.sensitivity = parseFloat(localStorage.getItem('mouseSensitivity')) || 1.0;

    // where the end portal/finish platform lives
    this.platformPos = new THREE.Vector3(-32.1, -6.73, 0.16);
    this.platformSize = new THREE.Vector3(3.55, 0.3, 3.55);

    // filled in by the level file — each checkpoint is { pos, size, activated, wasIn }
    this.checkpoints = [];

    // filled in by the level file — each kill brick is { pos, size }
    this.killBricks = [];

    // last checkpoint the player touched — used as respawn point
    this.activeCheckpoint = null;
    this.enterWasPressed = false;

    // green particle bursts that play when you hit a checkpoint
    this.checkpointExplosions = [];

    // prevents the kill brick from triggering every single frame
    this.lastKillBrickTime = 0;

    // coyote time lets you jump a tiny bit after walking off a ledge — feels way better
    this.coyoteTime = 0;
    this.coyoteMaxTime = 0.12; // 120ms window

    // cache these so we're not hitting getElementById on every frame
    this._timerEl = null;
    this._lastTimerText = '';
    this._cooldownFill = null;
    this._throwCount = null;
    this._cooldownLabel = null;

    // level files can push functions here to run custom animations each frame
    this.levelAnimations = [];

    // called when a checkpoint is activated, index = which checkpoint
    this.onCheckpointActivated = null;

    this.initWalkingSound();

    // we store all listeners so we can remove them cleanly on destroy
    this.eventListeners = {
      keydown: null,
      keyup: null,
      mousedown: null,
      mouseup: null,
      mousemove: null,
      touchstartBody: null,
      touchmoveBody: null,
      touchendBody: null,
      touchstartJump: null,
      touchendJump: null,
      touchstartThrow: null,
      touchendThrow: null,
      touchstartJoystick: null,
      touchmoveJoystick: null,
      touchendJoystick: null,
      resizeJoystick: null
    };

    this.initSpheres();
    this.initControls();
  }

  initWalkingSound() {
    this.walkingSound = new Audio('sound/walking.mp3');
    this.walkingSound.loop = true;
    this.walkingSound.volume = 0.5;
    this.walkingSound.playbackRate = 1.5;
    this.isWalkingSoundPlaying = false;
    this.oofSound = new Audio('sound/oof.mp3');
    this.oofSound.preload = 'auto';
    this.oofSound.volume = 0.9;
    // force the browser to download it now so there's no delay on first play
    this.oofSound.load();
  }

  playOofSound() {
    try {
      // clone the node so we don't have to seek to 0 — seeking causes the delay
      const s = this.oofSound.cloneNode();
      s.volume = 0.9;
      s.play().catch(() => {});
    } catch(e) {}
  }

  unloadWalkingSound() {
    // Stop and unload the walking sound completely
    if (this.walkingSound) {
      if (this.isWalkingSoundPlaying) {
        this.walkingSound.pause();
        this.isWalkingSoundPlaying = false;
      }
      this.walkingSound.src = '';
      this.walkingSound.load();
      this.walkingSound = null;
    }
  }

  initSpheres() {
    const sphereGeometry = new THREE.IcosahedronGeometry(this.SPHERE_RADIUS, 5);
    const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xdede8d });

    for (let i = 0; i < this.NUM_SPHERES; i++) {
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      sphere.position.set(0, -100, 0);
      this.scene.add(sphere);
      this.spheres.push({
        mesh: sphere,
        collider: new THREE.Sphere(new THREE.Vector3(0, -100, 0), this.SPHERE_RADIUS),
        velocity: new THREE.Vector3()
      });
    }
  }

  initControls() {
    // Store handlers for cleanup
    this.eventListeners.keydown = (e) => { this.keyStates[e.code] = true; };
    this.eventListeners.keyup = (e) => { this.keyStates[e.code] = false; };
    
    document.addEventListener('keydown', this.eventListeners.keydown);
    document.addEventListener('keyup', this.eventListeners.keyup);

    const container = document.getElementById('container');
    this.eventListeners.mousedown = () => {
      document.body.requestPointerLock();
      this.mouseTime = performance.now();
    };
    container.addEventListener('mousedown', this.eventListeners.mousedown);

    this.eventListeners.mouseup = () => {
      if (document.pointerLockElement !== null) this.throwBall();
    };
    document.addEventListener('mouseup', this.eventListeners.mouseup);

    this.eventListeners.mousemove = (event) => {
      if (document.pointerLockElement === document.body) {
        this.camera.rotation.y -= (event.movementX / 500) * this.sensitivity;
        this.camera.rotation.x -= (event.movementY / 500) * this.sensitivity;
        this.camera.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2, this.camera.rotation.x));
      }
    };
    document.body.addEventListener('mousemove', this.eventListeners.mousemove);

    this.initTouchControls();
    this.initJoystick();
  }

  initTouchControls() {
    let lookTouchId = null;
    let lookTouchX, lookTouchY;
    const joystickTouchId = null;

    this.eventListeners.touchstartBody = (event) => {
      for (const touch of event.changedTouches) {
        if (touch.clientX > window.innerWidth / 2 && lookTouchId === null && touch.identifier !== joystickTouchId) {
          lookTouchId = touch.identifier;
          lookTouchX = touch.clientX;
          lookTouchY = touch.clientY;
        }
      }
    };
    document.body.addEventListener('touchstart', this.eventListeners.touchstartBody, { passive: true });

    this.eventListeners.touchmoveBody = (event) => {
      for (const touch of event.changedTouches) {
        if (touch.identifier === lookTouchId && touch.identifier !== joystickTouchId) {
          const deltaX = touch.clientX - lookTouchX;
          const deltaY = touch.clientY - lookTouchY;
          const baseSensitivity = 200;
          const lookSensitivity = baseSensitivity / this.sensitivity;
          this.camera.rotation.y -= deltaX / lookSensitivity;
          this.camera.rotation.x -= deltaY / lookSensitivity;
          this.camera.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2, this.camera.rotation.x));
          lookTouchX = touch.clientX;
          lookTouchY = touch.clientY;
          event.preventDefault();
        }
      }
    };
    document.body.addEventListener('touchmove', this.eventListeners.touchmoveBody, { passive: false });

    this.eventListeners.touchendBody = (event) => {
      for (const touch of event.changedTouches) {
        if (touch.identifier === lookTouchId) lookTouchId = null;
      }
    };
    document.body.addEventListener('touchend', this.eventListeners.touchendBody, { passive: true });

    const jumpButton = document.getElementById("jump-button");
    let jumpRepeatInterval = null;

    const doJump = () => {
      if (this.playerOnFloor || this.coyoteTime > 0) {
        this.playerVelocity.y = this.JUMP_FORCE; // same velocity as keyboard jump
        this.coyoteTime = 0;        // consume coyote window
      }
    };

    this.eventListeners.touchstartJump = (e) => {
      e.preventDefault();
      doJump(); // fire immediately — zero delay on tap
      // Rapid repeat while held: fires again as soon as player lands,
      // with only 80ms polling so there's no perceptible lag between landing and next jump
      if (jumpRepeatInterval) clearInterval(jumpRepeatInterval);
      jumpRepeatInterval = setInterval(doJump, 80);
    };
    jumpButton.addEventListener("touchstart", this.eventListeners.touchstartJump, { passive: false });

    this.eventListeners.touchendJump = (e) => {
      e.preventDefault();
      if (jumpRepeatInterval) { clearInterval(jumpRepeatInterval); jumpRepeatInterval = null; }
    };
    jumpButton.addEventListener("touchend", this.eventListeners.touchendJump, { passive: false });

    const throwButton = document.getElementById("throw-button");
    let throwHoldTimer = null;

    const throwBallMobile = () => {
      this.mouseTime = performance.now();
      this.throwBall();
    };

    this.eventListeners.touchstartThrow = (e) => {
      e.preventDefault();
      throwHoldTimer = setTimeout(() => {
        throwBallMobile();
      }, 2000);
    };
    throwButton.addEventListener("touchstart", this.eventListeners.touchstartThrow);

    this.eventListeners.touchendThrow = (e) => {
      e.preventDefault();
      if (throwHoldTimer) {
        clearTimeout(throwHoldTimer);
        throwBallMobile();
        throwHoldTimer = null;
      }
    };
    throwButton.addEventListener("touchend", this.eventListeners.touchendThrow);
  }

  initJoystick() {
    const joystickZone = document.getElementById('joystick-zone');
    const joystickStick = document.getElementById('joystick-stick');
    let joystickTouchId = null;
    const joystickCenter = { x: 60, y: 60 };

    let zoneRect = null;
    const updateZoneRect = () => { 
      zoneRect = joystickZone.getBoundingClientRect();
    };
    this.updateJoystickRect = updateZoneRect;
    updateZoneRect();
    
    this.eventListeners.resizeJoystick = updateZoneRect;
    window.addEventListener('resize', this.eventListeners.resizeJoystick);

    this.eventListeners.touchstartJoystick = (e) => {
      for (const touch of e.changedTouches) {
        if (joystickTouchId === null) {
          updateZoneRect();
          const x = touch.clientX - (zoneRect.left + joystickCenter.x);
          const y = touch.clientY - (zoneRect.top + joystickCenter.y);
          if (x * x + y * y <= 60 * 60) {
            joystickTouchId = touch.identifier;
            joystickStick.style.transition = 'none';
            const dx = touch.clientX - (zoneRect.left + joystickCenter.x);
            const dy = touch.clientY - (zoneRect.top + joystickCenter.y);
            joystickStick.style.left = (joystickCenter.x + dx - 25) + 'px';
            joystickStick.style.top = (joystickCenter.y + dy - 25) + 'px';
            e.preventDefault();
          }
        }
      }
    };
    joystickZone.addEventListener('touchstart', this.eventListeners.touchstartJoystick, { passive: false });

    this.eventListeners.touchmoveJoystick = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
          // No getBoundingClientRect() here — rect was captured on touchstart,
          // kept fresh by the resize listener. Calling it every touchmove causes
          // a forced layout reflow on every finger movement which adds latency.
          let dx = touch.clientX - (zoneRect.left + joystickCenter.x);
          let dy = touch.clientY - (zoneRect.top + joystickCenter.y);
          const maxR = 40;
          const dist = Math.hypot(dx, dy);

          if (dist > maxR) {
            const angle = Math.atan2(dy, dx);
            dx = Math.cos(angle) * maxR;
            dy = Math.sin(angle) * maxR;
          }

          this.joystickDX = dx / maxR;
          this.joystickDY = dy / maxR;

          joystickStick.style.left = (joystickCenter.x + dx - 25) + 'px';
          joystickStick.style.top = (joystickCenter.y + dy - 25) + 'px';
          e.preventDefault();
        }
      }
    };
    joystickZone.addEventListener('touchmove', this.eventListeners.touchmoveJoystick, { passive: false });

    this.eventListeners.touchendJoystick = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
          joystickTouchId = null;
          this.joystickDX = 0;
          this.joystickDY = 0;
          joystickStick.style.transition = 'left 0.1s ease-out, top 0.1s ease-out';
          joystickStick.style.left = (joystickCenter.x - 25) + 'px';
          joystickStick.style.top = (joystickCenter.y - 25) + 'px';
          e.preventDefault();
        }
      }
    };
    joystickZone.addEventListener('touchend', this.eventListeners.touchendJoystick, { passive: false });
  }


  destroy() {
    // Unload walking sound completely
    this.unloadWalkingSound();

    if (this.oofSound) {
      this.oofSound.pause();
      this.oofSound.src = '';
      this.oofSound = null;
    }

    // clean up thrown balls
    if (this.spheres && this.spheres.length > 0) {
      this.spheres.forEach(sphere => {
        if (sphere.mesh) {
          this.scene.remove(sphere.mesh);
          if (sphere.mesh.geometry) sphere.mesh.geometry.dispose();
          if (sphere.mesh.material) sphere.mesh.material.dispose();
        }
      });
      this.spheres = [];
    }
    
    // clean up shockwave rings
    if (this.shockwaves && this.shockwaves.length > 0) {
      this.shockwaves.forEach(shockwave => {
        if (shockwave.mesh) {
          this.scene.remove(shockwave.mesh);
          if (shockwave.mesh.geometry) shockwave.mesh.geometry.dispose();
          if (shockwave.mesh.material) shockwave.mesh.material.dispose();
        }
      });
      this.shockwaves = [];
    }
    
    // remove all listeners we added
    if (this.eventListeners.keydown) {
      document.removeEventListener('keydown', this.eventListeners.keydown);
    }
    if (this.eventListeners.keyup) {
      document.removeEventListener('keyup', this.eventListeners.keyup);
    }
    
    const container = document.getElementById('container');
    if (this.eventListeners.mousedown && container) {
      container.removeEventListener('mousedown', this.eventListeners.mousedown);
    }
    if (this.eventListeners.mouseup) {
      document.removeEventListener('mouseup', this.eventListeners.mouseup);
    }
    if (this.eventListeners.mousemove) {
      document.body.removeEventListener('mousemove', this.eventListeners.mousemove);
    }
    
    if (this.eventListeners.touchstartBody) {
      document.body.removeEventListener('touchstart', this.eventListeners.touchstartBody);
    }
    if (this.eventListeners.touchmoveBody) {
      document.body.removeEventListener('touchmove', this.eventListeners.touchmoveBody);
    }
    if (this.eventListeners.touchendBody) {
      document.body.removeEventListener('touchend', this.eventListeners.touchendBody);
    }
    
    const jumpButton = document.getElementById("jump-button");
    if (this.eventListeners.touchstartJump && jumpButton) {
      jumpButton.removeEventListener("touchstart", this.eventListeners.touchstartJump);
    }
    if (this.eventListeners.touchendJump && jumpButton) {
      jumpButton.removeEventListener("touchend", this.eventListeners.touchendJump);
    }
    
    const throwButton = document.getElementById("throw-button");
    if (this.eventListeners.touchstartThrow && throwButton) {
      throwButton.removeEventListener("touchstart", this.eventListeners.touchstartThrow);
    }
    if (this.eventListeners.touchendThrow && throwButton) {
      throwButton.removeEventListener("touchend", this.eventListeners.touchendThrow);
    }
    
    const joystickZone = document.getElementById('joystick-zone');
    if (this.eventListeners.touchstartJoystick && joystickZone) {
      joystickZone.removeEventListener('touchstart', this.eventListeners.touchstartJoystick);
    }
    if (this.eventListeners.touchmoveJoystick && joystickZone) {
      joystickZone.removeEventListener('touchmove', this.eventListeners.touchmoveJoystick);
    }
    if (this.eventListeners.touchendJoystick && joystickZone) {
      joystickZone.removeEventListener('touchend', this.eventListeners.touchendJoystick);
    }
    
    if (this.eventListeners.resizeJoystick) {
      window.removeEventListener('resize', this.eventListeners.resizeJoystick);
    }
    
    this.keyStates = {};

    // null out dom refs so this instance can be garbage collected cleanly
    this._timerEl = null;
    this._lastTimerText = '';
    this._cooldownFill = null;
    this._throwCount = null;
    this._cooldownLabel = null;
  }

  pause() {
    this.isPaused = true;
    this.clock.stop();
    
    if (this.isWalkingSoundPlaying) {
      this.walkingSound.pause();
    }
    
    // remember when we paused so we can subtract it from the final time
    if (this.startTime && !this.pauseStartTime && !this.levelCompleted) {
      this.pauseStartTime = performance.now();
    }
  }

  resume() {
    this.isPaused = false;
    this.clock.start();
    
    if (this.pauseStartTime && !this.levelCompleted) {
      this.pausedTime += performance.now() - this.pauseStartTime;
      this.pauseStartTime = null;
    }
  }

  throwBall() {
    if (!this.useBalls) return;
    if (this.throwTimer > 0) return;
    if (this.ballsThrown >= this.NUM_SPHERES) return; // Ball limit reached

    const sphere = this.spheres[this.sphereIdx];
    this.camera.getWorldDirection(this.playerDirection);
    sphere.collider.center.copy(this.playerCollider.end).addScaledVector(this.playerDirection, this.playerCollider.radius * 1.5);
    const impulse = 15 + 30 * (1 - Math.exp((this.mouseTime - performance.now()) * 0.001));
    sphere.velocity.copy(this.playerDirection).multiplyScalar(impulse);
    sphere.velocity.addScaledVector(this.playerVelocity, 2);
    this.sphereIdx = (this.sphereIdx + 1) % this.spheres.length;
    this.ballsThrown++;

    this.throwTimer = this.throwCooldown;
  }

  createShockwave(position, color = 0x00aaff) {
    const ringCount = 40;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(ringCount * 3);
    const angles = [];
    const speeds = [];

    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      angles.push(angle);
      speeds.push(4 + Math.random() * 2);

      positions[i * 3 + 0] = position.x + Math.cos(angle) * 0.1;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z + Math.sin(angle) * 0.1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size: 0.3,
      transparent: true,
      opacity: 1,
    });

    const ring = new THREE.Points(geometry, material);
    this.scene.add(ring);

    const playerPos = this.playerCollider.end.clone();
    const dist = playerPos.distanceTo(position);
    if (dist < 2) {
      this.playerVelocity.y = 1.5;
    }

    this.shockwaves.push({ mesh: ring, angles, speeds, life: 1, position: position.clone() });
  }

  playerCollisions() {
    const result = this.worldOctree.capsuleIntersect(this.playerCollider);
    this.playerOnFloor = false;
    if (result) {
      this.playerOnFloor = result.normal.y > 0;
      if (!this.playerOnFloor) this.playerVelocity.addScaledVector(result.normal, -result.normal.dot(this.playerVelocity));
      if (result.depth >= 1e-10) this.playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }
  }

  updatePlayer(deltaTime) {

    let damping = Math.exp(-20 * deltaTime) - 1;
    if (!this.playerOnFloor) {
      this.playerVelocity.y -= this.GRAVITY * deltaTime;
      damping *= 0.1;
    }
    this.playerVelocity.addScaledVector(this.playerVelocity, damping);
    const deltaPosition = this.playerVelocity.clone().multiplyScalar(deltaTime);
    this.playerCollider.translate(deltaPosition);
    this.playerCollisions();

    // Coyote time: refresh when on floor, count down when airborne
    if (this.playerOnFloor) {
      this.coyoteTime = this.coyoteMaxTime;
    } else {
      this.coyoteTime = Math.max(0, this.coyoteTime - deltaTime);
    }

    const CAMERA_NOSE_OFFSET = 0.08;
    const CAMERA_UP_OFFSET = 0.09;
    const CAMERA_LEFT_OFFSET = -0.03;

    const forward = this.getForwardVector().clone().normalize().multiplyScalar(CAMERA_NOSE_OFFSET);
    const side = this.getSideVector().clone().normalize().multiplyScalar(CAMERA_LEFT_OFFSET);
    const up = new THREE.Vector3(0, CAMERA_UP_OFFSET, 0);

    this.camera.position.copy(this.playerCollider.end)
      .add(forward)
      .add(side)
      .add(up);
  }

  playerSphereCollision(sphere) {
    const center = this.vector1.addVectors(this.playerCollider.start, this.playerCollider.end).multiplyScalar(0.5);
    const sphere_center = sphere.collider.center;
    const r = this.playerCollider.radius + sphere.collider.radius;
    const r2 = r * r;
    for (const point of [this.playerCollider.start, this.playerCollider.end, center]) {
      const d2 = point.distanceToSquared(sphere_center);
      if (d2 < r2) {
        const normal = this.vector1.subVectors(point, sphere_center).normalize();
        const v1 = this.vector2.copy(normal).multiplyScalar(normal.dot(this.playerVelocity));
        const v2 = this.vector3.copy(normal).multiplyScalar(normal.dot(sphere.velocity));
        this.playerVelocity.add(v2).sub(v1);
        sphere.velocity.add(v1).sub(v2);
        const d = (r - Math.sqrt(d2)) / 2;
        sphere_center.addScaledVector(normal, -d);
      }
    }
  }

  spheresCollisions() {
    for (let i = 0, length = this.spheres.length; i < length; i++) {
      const s1 = this.spheres[i];
      for (let j = i + 1; j < length; j++) {
        const s2 = this.spheres[j];
        const d2 = s1.collider.center.distanceToSquared(s2.collider.center);
        const r = s1.collider.radius + s2.collider.radius;
        const r2 = r * r;
        if (d2 < r2) {
          const normal = this.vector1.subVectors(s1.collider.center, s2.collider.center).normalize();
          const v1 = this.vector2.copy(normal).multiplyScalar(normal.dot(s1.velocity));
          const v2 = this.vector3.copy(normal).multiplyScalar(normal.dot(s2.velocity));
          s1.velocity.add(v2).sub(v1);
          s2.velocity.add(v1).sub(v2);
          const d = (r - Math.sqrt(d2)) / 2;
          s1.collider.center.addScaledVector(normal, d);
          s2.collider.center.addScaledVector(normal, -d);
        }
      }
    }
  }

  updateSpheres(deltaTime) {
    this.spheres.forEach(sphere => {
      sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);
      const result = this.worldOctree.sphereIntersect(sphere.collider);
      if (result) {
        if (!sphere.hasExploded) {
          this.createShockwave(sphere.collider.center.clone(), 0x00aaff);
          sphere.hasExploded = true;
        }
        sphere.velocity.addScaledVector(result.normal, -result.normal.dot(sphere.velocity) * 1.5);
        sphere.collider.center.add(result.normal.multiplyScalar(result.depth));
      } else {
        sphere.velocity.y -= this.GRAVITY * deltaTime;
      }
      const damping = Math.exp(-1.5 * deltaTime) - 1;
      sphere.velocity.addScaledVector(sphere.velocity, damping);
    });
    this.spheresCollisions();
    for (const sphere of this.spheres) sphere.mesh.position.copy(sphere.collider.center);
  }

  updateShockwaves(deltaTime) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= deltaTime * 12;

      const pos = s.mesh.geometry.attributes.position;
      for (let j = 0; j < s.angles.length; j++) {
        const r = (1 - s.life) * 6;
        const playerPos = this.playerCollider.end.clone();
        const dist = playerPos.distanceTo(s.position);

        if (dist < r && dist > r - 1) {
          this.playerVelocity.y = 25;
        }
        pos.array[j * 3 + 0] = s.position.x + Math.cos(s.angles[j]) * r;
        pos.array[j * 3 + 1] = s.position.y;
        pos.array[j * 3 + 2] = s.position.z + Math.sin(s.angles[j]) * r;
      }

      pos.needsUpdate = true;
      s.mesh.material.opacity = Math.max(0, s.life);

      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.shockwaves.splice(i, 1);
      }
    }
  }

  getForwardVector() {
    this.camera.getWorldDirection(this.playerDirection);
    this.playerDirection.y = 0;
    this.playerDirection.normalize();
    return this.playerDirection;
  }

  getSideVector() {
    this.camera.getWorldDirection(this.playerDirection);
    this.playerDirection.y = 0;
    this.playerDirection.normalize();
    this.playerDirection.cross(this.camera.up);
    return this.playerDirection;
  }

  controls(deltaTime) {
    const speedDelta = deltaTime * (this.isCreativeMode ? this.playerSpeed : (this.playerOnFloor ? this.playerSpeed : this.airControl));
    if (this.keyStates['KeyW']) this.playerVelocity.add(this.getForwardVector().multiplyScalar(speedDelta));
    if (this.keyStates['KeyS']) this.playerVelocity.add(this.getForwardVector().multiplyScalar(-speedDelta));
    if (this.keyStates['KeyA']) this.playerVelocity.add(this.getSideVector().multiplyScalar(-speedDelta));
    if (this.keyStates['KeyD']) this.playerVelocity.add(this.getSideVector().multiplyScalar(speedDelta));

    {
      // Coyote jump: allow jump for 120ms after leaving edge
      if ((this.playerOnFloor || this.coyoteTime > 0) && this.keyStates['Space']) {
        this.playerVelocity.y = this.JUMP_FORCE;
        this.coyoteTime = 0; // consume coyote window so it only fires once
      }
    }
  }

  joystickControls(deltaTime) {
    if (this.joystickDX !== 0 || this.joystickDY !== 0) {
      const speedDelta = deltaTime * (this.playerOnFloor ? this.playerSpeed : this.airControl);
      this.playerVelocity.add(this.getForwardVector().multiplyScalar(-this.joystickDY * speedDelta));
      this.playerVelocity.add(this.getSideVector().multiplyScalar(this.joystickDX * speedDelta));
    }
  }

  teleportPlayerIfOob() {
    if (this.camera.position.y <= -25) {
      this.deathCount++;
      this.playOofSound();
      this.playerVelocity.set(0, 0, 0);

      if (this.activeCheckpoint) {
        const cp = this.activeCheckpoint;
        this.playerCollider.start.set(cp.startX, cp.startY, cp.startZ);
        this.playerCollider.end.set(cp.endX, cp.endY, cp.endZ);
        this.playerCollider.radius = 0.18;
        this.camera.position.copy(this.playerCollider.end);
        this.camera.rotation.set(cp.rotX, cp.rotY, 0);
      } else {
        this.playerCollider.start.set(0, 0.35, 0);
        this.playerCollider.end.set(0, 1.55, 0);
        this.playerCollider.radius = 0.18;
        this.camera.position.copy(this.playerCollider.end);
        const rotationY = this.config.playerLookAt?.rotationY || 0;
        const rotationX = this.config.playerLookAt?.rotationX || 0;
        this.camera.rotation.set(rotationX, rotationY, 0);
      }
    }
  }

  checkPlatformCollision() {
    if (this.levelCompleted) return;

    const platformPos = this.platformPos;
    const platformSize = this.platformSize;
    const playerPos = this.playerCollider.end.clone();

    const dx = Math.abs(playerPos.x - platformPos.x);
    const dy = Math.abs(playerPos.y - platformPos.y);
    const dz = Math.abs(playerPos.z - platformPos.z);

    if (
      dx < platformSize.x / 2 + 0.5 &&
      dy < platformSize.y / 2 + 1.5 &&
      dz < platformSize.z / 2 + 0.5
    ) {
      this.completeLevel();
    }
  }

  checkCheckpointCollision() {
    if (!this.checkpoints.length) return;
    const playerPos = this.playerCollider.end.clone();

    this.checkpoints.forEach((cp, idx) => {
      if (cp.activated) return;
      const dx = Math.abs(playerPos.x - cp.pos.x);
      const dy = Math.abs(playerPos.y - cp.pos.y);
      const dz = Math.abs(playerPos.z - cp.pos.z);
      const inside = dx < cp.size.x / 2 + 0.5 && dy < cp.size.y / 2 + 1.5 && dz < cp.size.z / 2 + 0.5;
      if (inside && !cp.wasIn) {
        this.activeCheckpoint = {
          startX: cp.pos.x, startY: cp.pos.y + 0.5, startZ: cp.pos.z,
          endX: cp.pos.x, endY: cp.pos.y + 1.65, endZ: cp.pos.z,
          rotX: this.camera.rotation.x, rotY: this.camera.rotation.y
        };
        cp.activated = true;
        this.createCheckpointExplosion(new THREE.Vector3(cp.pos.x, cp.pos.y, cp.pos.z));
        try { const s = new Audio('sound/startBtn.mp3'); s.volume = 0.8; s.play().catch(() => {}); } catch (e) {}
        if (this.onCheckpointActivated) this.onCheckpointActivated(idx);
      }
      cp.wasIn = inside;
    });
  }

  checkKillBrickCollision() {
    if (!this.killBricks.length) return;
    if (performance.now() - this.lastKillBrickTime < 1500) return;
    const playerPos = this.playerCollider.end.clone();
    for (const kb of this.killBricks) {
      const dx = Math.abs(playerPos.x - kb.pos.x);
      const dy = Math.abs(playerPos.y - kb.pos.y);
      const dz = Math.abs(playerPos.z - kb.pos.z);
      if (dx < kb.size.x / 2 + 0.22 && dy < kb.size.y / 2 + 0.95 && dz < kb.size.z / 2 + 0.22) {
        this.deathCount++;
        this.playOofSound();
        this.lastKillBrickTime = performance.now();
        this.playerVelocity.set(0, 0, 0);
        if (this.activeCheckpoint) {
          const cp = this.activeCheckpoint;
          this.playerCollider.start.set(cp.startX, cp.startY, cp.startZ);
          this.playerCollider.end.set(cp.endX, cp.endY, cp.endZ);
          this.playerCollider.radius = 0.18;
          this.camera.position.copy(this.playerCollider.end);
          this.camera.rotation.set(cp.rotX, cp.rotY, 0);
        } else {
          this.playerCollider.start.set(0, 0.35, 0);
          this.playerCollider.end.set(0, 1.55, 0);
          this.playerCollider.radius = 0.18;
          this.camera.position.copy(this.playerCollider.end);
          const ry = this.config.playerLookAt?.rotationY || 0;
          const rx = this.config.playerLookAt?.rotationX || 0;
          this.camera.rotation.set(rx, ry, 0);
        }
        break;
      }
    }
  }

  createCheckpointExplosion(position) {
    // draw a little circle gradient onto a canvas so the particles look round
    const cvs = document.createElement('canvas');
    cvs.width = 32; cvs.height = 32;
    const ctx2d = cvs.getContext('2d');
    const grad = ctx2d.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0,   'rgba(180,255,220,1)');
    grad.addColorStop(0.3, 'rgba(0,255,136,1)');
    grad.addColorStop(1,   'rgba(0,255,136,0)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, 32, 32);
    const circleTex = new THREE.CanvasTexture(cvs);

    const count = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = position.x;
      pos[i * 3 + 1] = position.y + 0.1;
      pos[i * 3 + 2] = position.z;
      // pick a random direction uniformly across a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const speed = 10 + Math.random() * 18;
      vels.push({
        x: Math.sin(phi) * Math.cos(theta) * speed,
        y: Math.sin(phi) * Math.sin(theta) * speed + 4,
        z: Math.cos(phi) * speed
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: circleTex,
      color: 0x00ff88,
      size: 0.07,
      transparent: true,
      opacity: 1,
      alphaTest: 0.01,
      sizeAttenuation: true,
      depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.checkpointExplosions.push({ mesh: pts, vels, posArr: pos, count, life: 1.4 });
  }

  updateCheckpointExplosions(deltaTime) {
    for (let i = this.checkpointExplosions.length - 1; i >= 0; i--) {
      const exp = this.checkpointExplosions[i];
      exp.life -= deltaTime * 1.8;
      const pa = exp.posArr;
      for (let j = 0; j < exp.count; j++) {
        pa[j * 3]     += exp.vels[j].x * deltaTime;
        pa[j * 3 + 1] += exp.vels[j].y * deltaTime;
        pa[j * 3 + 2] += exp.vels[j].z * deltaTime;
        exp.vels[j].x *= 0.97;
        exp.vels[j].y -= 14 * deltaTime;
        exp.vels[j].z *= 0.97;
      }
      exp.mesh.geometry.attributes.position.needsUpdate = true;
      exp.mesh.material.opacity = Math.max(0, exp.life);
      if (exp.life <= 0) {
        this.scene.remove(exp.mesh);
        exp.mesh.geometry.dispose();
        if (exp.mesh.material.map) exp.mesh.material.map.dispose();
        exp.mesh.material.dispose();
        this.checkpointExplosions.splice(i, 1);
      }
    }
  }

  completeLevel() {
    this.levelCompleted = true;
    
    this.unloadWalkingSound();
    
    // grab the time before we pause — pausing would mess up the calculation
    const elapsedTime = (performance.now() - this.startTime - this.pausedTime) / 1000;
    this.completionTime = elapsedTime;
    const formattedTime = this.formatTime(elapsedTime);
    
    const stars = this.calculateStars(elapsedTime, this.deathCount);
    
    if (window.saveLevelStats) {
      window.saveLevelStats(this.levelNumber, {
        time: elapsedTime,
        deaths: this.deathCount,
        stars: stars
      });
    }
    
    this.pause();

    const completionSound = new Audio('sound/levelCompleted.mp3');
    completionSound.play().catch(err => console.log('Completion sound error:', err));

    const completionScreen = document.getElementById('completion-screen');
    const levelNumberEl = document.getElementById('completion-level-number');
    const timeEl = document.getElementById('completion-time');

    levelNumberEl.textContent = this.levelNumber;
    timeEl.textContent = formattedTime;

    const starElements = document.querySelectorAll('.completion-star');
    starElements.forEach(star => {
      star.classList.remove('earned', 'grey');
    });

    completionScreen.classList.add('active');
    this.animateStars(stars);

    if (window.markLevelCompleted) {
      window.markLevelCompleted(this.levelNumber);
    }

    const nextLevel = this.levelNumber + 1;
    if (window.unlockLevel) {
      window.unlockLevel(nextLevel);
    }
  }

  animateStars(earnedStars) {
    const starElements = document.querySelectorAll('.completion-star');
    const starSound = new Audio('sound/startBtn.mp3');
    
    // show all stars as grey first, then light up the earned ones
    starElements.forEach((star, index) => {
      setTimeout(() => {
        star.classList.add('grey');
      }, index * 300);
    });

    setTimeout(() => {
      for (let i = 0; i < earnedStars; i++) {
        setTimeout(() => {
          starElements[i].classList.remove('grey');
          starElements[i].classList.add('earned');
          const sound = new Audio('sound/startBtn.mp3');
          sound.volume = 0.6;
          sound.play().catch(err => console.log('Star sound error:', err));
        }, i * 600);
      }
    }, starElements.length * 300 + 400);
  }

  calculateStars(timeInSeconds, deaths) {
    let stars = 0;
    if (timeInSeconds < 120) stars++; // finish under 2 mins
    if (timeInSeconds < 60)  stars++; // finish under 1 min
    if (deaths < 5)          stars++; // die less than 5 times
    return stars;
  }

  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs.toFixed(2)}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs.toFixed(2)}s`;
    } else {
      return `${secs.toFixed(2)}s`;
    }
  }

  formatTimeLegacy(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${Math.floor(secs)}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${Math.floor(secs)}s`;
    } else {
      return `${secs.toFixed(1)}s`;
    }
  }

  startTimer() {
    if (!this.startTime) {
      this.startTime = performance.now();
    }
  }

  resetTimer() {
    this.startTime = null;
    this.pausedTime = 0;
    this.pauseStartTime = null;
    this.completionTime = null;
    this.levelCompleted = false;
    this.deathCount = 0;
    this.activeCheckpoint = null;
    this.checkpoints.forEach(cp => { cp.activated = false; cp.wasIn = false; });
    if (this.onCheckpointsReset) this.onCheckpointsReset();
  }

  animate() {
    if (this.isPaused) return;

    const deltaTime = Math.min(0.05, this.clock.getDelta()) / this.STEPS_PER_FRAME;
    for (let i = 0; i < this.STEPS_PER_FRAME; i++) {
      this.controls(deltaTime);
      this.joystickControls(deltaTime);
      this.updatePlayer(deltaTime);
      if (this.useBalls) {
        this.updateSpheres(deltaTime);
      }
      this.teleportPlayerIfOob();
      this.checkPlatformCollision();
      this.checkCheckpointCollision();
      this.checkKillBrickCollision();
    }

    // press enter to reset back to the start (clears checkpoints too)
    if (this.keyStates['Enter'] && !this.enterWasPressed) {
      this.activeCheckpoint = null;
      this.checkpoints.forEach(cp => { cp.activated = false; cp.wasIn = false; });
      this.playerCollider.start.set(0, 0.35, 0);
      this.playerCollider.end.set(0, 1.55, 0);
      this.playerCollider.radius = 0.18;
      this.playerVelocity.set(0, 0, 0);
      this.camera.position.copy(this.playerCollider.end);
      const rotY = this.config.playerLookAt?.rotationY || 0;
      const rotX = this.config.playerLookAt?.rotationX || 0;
      this.camera.rotation.set(rotX, rotY, 0);
      if (this.onCheckpointsReset) this.onCheckpointsReset();
    }
    this.enterWasPressed = !!this.keyStates['Enter'];

    const moving = this.keyStates['KeyW'] || this.keyStates['KeyA'] || this.keyStates['KeyS'] ||
                   this.keyStates['KeyD'] || this.joystickDX !== 0 || this.joystickDY !== 0;

    if (moving) {
      this.startTimer();
    }

    const frameDelta = deltaTime * this.STEPS_PER_FRAME;
    if (moving && this.playerOnFloor) {
      this.bobTime += frameDelta * this.BOB_SPEED;
      this.camera.position.y += Math.sin(this.bobTime) * this.BOB_STRENGTH;           // up/down bounce
      this.camera.rotation.z = Math.sin(this.bobTime * 0.5) * (this.BOB_STRENGTH * 0.345); // gentle side roll
      this.camera.rotation.x += Math.sin(this.bobTime) * (this.BOB_STRENGTH * 0.036);  // slight pitch sway
    } else {
      this.camera.rotation.z *= 0.72; // ease the tilt back to straight
    }

    const shouldPlayWalkingSound = moving && this.playerOnFloor;
    if (shouldPlayWalkingSound && !this.isWalkingSoundPlaying) {
      this.walkingSound.play().catch(err => console.log('Walking sound error:', err));
      this.isWalkingSoundPlaying = true;
    } else if (!shouldPlayWalkingSound && this.isWalkingSoundPlaying) {
      this.walkingSound.pause();
      this.walkingSound.currentTime = 0;
      this.isWalkingSoundPlaying = false;
    }


    if (this.startTime) {
      if (!this._timerEl) this._timerEl = document.getElementById('game-timer');
      if (this._timerEl) {
        let elapsedTime;
        if (this.levelCompleted && this.completionTime !== null) {
          elapsedTime = this.completionTime;
        } else {
          elapsedTime = (performance.now() - this.startTime - this.pausedTime) / 1000;
        }
        const text = this.formatTime(elapsedTime);
        if (text !== this._lastTimerText) {
          const spanEl = this._timerEl.querySelector('#timer-text');
          if (spanEl) { spanEl.textContent = text; } else { this._timerEl.textContent = text; }
          this._lastTimerText = text;
        }
      }
    }

    if (this.useBalls) {
      // tick down the throw cooldown (use frameDelta from above, not clock.getDelta() again — that'd return ~0)
      this.throwTimer = Math.max(0, this.throwTimer - frameDelta);

      if (!this._cooldownFill)  this._cooldownFill  = document.getElementById('throw-cooldown-fill');
      if (!this._throwCount)    this._throwCount    = document.getElementById('throw-count');
      if (!this._cooldownLabel) this._cooldownLabel = document.getElementById('throw-cooldown-label');
      const cooldownFill  = this._cooldownFill;
      const throwCount    = this._throwCount;
      const cooldownLabel = this._cooldownLabel;

      if (this.ballsThrown >= this.NUM_SPHERES) {
        // out of balls
        if (cooldownFill) {
          cooldownFill.style.transform = 'scaleX(1)';
          cooldownFill.style.background = 'linear-gradient(90deg, #b91c1c 0%, #ef4444 100%)';
          cooldownFill.style.boxShadow = '0 0 8px rgba(239,68,68,0.7)';
        }
        if (throwCount)    throwCount.textContent    = `0/${this.NUM_SPHERES}`;
        if (cooldownLabel) { cooldownLabel.textContent = 'EMPTY'; cooldownLabel.style.color = 'rgba(239,68,68,0.9)'; }
      } else if (this.throwTimer > 0) {
        // still on cooldown
        const ratio = 1 - (this.throwTimer / this.throwCooldown);
        const secs  = this.throwTimer.toFixed(1);
        if (cooldownFill) {
          cooldownFill.style.transform = `scaleX(${ratio})`;
          cooldownFill.style.background = 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)';
          cooldownFill.style.boxShadow = '0 0 8px rgba(251,191,36,0.7)';
        }
        if (throwCount)    throwCount.textContent    = `${this.NUM_SPHERES - this.ballsThrown}/${this.NUM_SPHERES}`;
        if (cooldownLabel) { cooldownLabel.textContent = `${secs}s`; cooldownLabel.style.color = 'rgba(251,191,36,0.9)'; }
      } else {
        // ready to throw
        if (cooldownFill) {
          cooldownFill.style.transform = 'scaleX(1)';
          cooldownFill.style.background = 'linear-gradient(90deg, #4facfe 0%, #00f2fe 100%)';
          cooldownFill.style.boxShadow = '0 0 10px rgba(79,172,254,0.9)';
        }
        if (throwCount)    throwCount.textContent    = `${this.NUM_SPHERES - this.ballsThrown}/${this.NUM_SPHERES}`;
        if (cooldownLabel) { cooldownLabel.textContent = 'READY'; cooldownLabel.style.color = 'rgba(79,172,254,0.85)'; }
      }
    }

    this.updateCheckpointExplosions(deltaTime);

    // run any animations the level file registered (like floating checkpoint labels)
    if (this.levelAnimations.length) {
      const t = performance.now() / 1000;
      this.levelAnimations.forEach(fn => fn(t));
    }

    this.updateShockwaves(deltaTime);
  }
}
