// Unified input state: keyboard, mouse and touch (touch UI writes into this object)
export class Input {
  moveX = 0;
  moveY = 0;
  touchX = 0;
  touchY = 0;
  lookDX = 0;
  lookDY = 0;
  keys = new Set<string>();
  sprintHeld = false;
  jumpHeld = false;
  jumpPressed = false;
  firing = false;
  touchFire = false;
  touchSprint = false;
  interactPressed = false;
  spellQueue: number[] = [];
  pausePressed = false;
  journalPressed = false;
  wheel = 0;
  isTouchActive = false;

  reset() {
    this.keys.clear();
    this.firing = false;
    this.touchFire = false;
    this.jumpHeld = false;
    this.jumpPressed = false;
    this.interactPressed = false;
    this.spellQueue.length = 0;
    this.lookDX = this.lookDY = 0;
    this.touchX = this.touchY = 0;
  }

  poll() {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) y += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    x += this.touchX;
    y += this.touchY;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.moveX = x;
    this.moveY = y;
    this.sprintHeld = k.has("ShiftLeft") || k.has("ShiftRight") || this.touchSprint || (this.isTouchActive && Math.hypot(this.touchX, this.touchY) > 0.92);
    this.jumpHeld = k.has("Space") || this.jumpHeldTouch;
  }
  jumpHeldTouch = false;

  keyDown(e: KeyboardEvent) {
    if (e.repeat) {
      if (["Space", "Tab"].includes(e.code)) e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    switch (e.code) {
      case "Space":
        this.jumpPressed = true;
        e.preventDefault();
        break;
      case "KeyE":
      case "Enter":
        this.interactPressed = true;
        break;
      case "Digit1":
        this.spellQueue.push(0);
        break;
      case "Digit2":
      case "KeyQ":
        this.spellQueue.push(1);
        break;
      case "Digit3":
      case "KeyR":
        this.spellQueue.push(2);
        break;
      case "Digit4":
      case "KeyC":
      case "KeyF":
        this.spellQueue.push(3);
        break;
      case "Tab":
      case "KeyI":
      case "KeyM":
        this.journalPressed = true;
        e.preventDefault();
        break;
      case "KeyP":
      case "Escape":
        this.pausePressed = true;
        break;
    }
  }
  keyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }
}
