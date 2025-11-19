/**
 * Advanced Spring Physics System
 * Supports multiple properties (x, y, scale, etc.) simultaneously.
 */

export interface SpringConfig {
    mass: number;
    stiffness: number;
    damping: number;
    precision?: number; // Stop threshold
}

export const DEFAULT_SPRING: SpringConfig = {
    mass: 1,
    stiffness: 120,
    damping: 20,
    precision: 0.01
};

export class SpringSystem {
    private current: Record<string, number> = {};
    private target: Record<string, number> = {};
    private velocity: Record<string, number> = {};
    private config: Record<string, SpringConfig> = {};
    
    constructor(initialValues: Record<string, number>) {
        this.current = { ...initialValues };
        this.target = { ...initialValues };
        // Initialize velocities to 0
        Object.keys(initialValues).forEach(k => this.velocity[k] = 0);
    }

    setTarget(key: string, value: number, config: SpringConfig = DEFAULT_SPRING) {
        this.target[key] = value;
        this.config[key] = config;
        if (this.velocity[key] === undefined) this.velocity[key] = 0;
        if (this.current[key] === undefined) this.current[key] = value;
    }

    // Force a value immediately (reset)
    setValue(key: string, value: number) {
        this.current[key] = value;
        this.target[key] = value;
        this.velocity[key] = 0;
    }

    // Inject momentum (e.g. scroll flick)
    setVelocity(key: string, value: number) {
        this.velocity[key] = value;
    }

    getCurrent(key: string): number {
        return this.current[key] || 0;
    }

    update(dt: number): boolean {
        let isMoving = false;

        Object.keys(this.current).forEach(key => {
            const p = this.config[key] || DEFAULT_SPRING;
            const target = this.target[key];
            const current = this.current[key];
            const velocity = this.velocity[key];

            // Spring Force Calculation (Hooke's Law + Damping)
            // F = -k(x - target) - c(v)
            const displacement = current - target;
            const springForce = -p.stiffness * displacement;
            const dampingForce = -p.damping * velocity;
            const acceleration = (springForce + dampingForce) / p.mass;

            const newVelocity = velocity + acceleration * dt;
            const newPosition = current + newVelocity * dt;

            // Check for rest
            if (Math.abs(newVelocity) < (p.precision || 0.01) && Math.abs(newPosition - target) < (p.precision || 0.01)) {
                this.current[key] = target;
                this.velocity[key] = 0;
            } else {
                this.current[key] = newPosition;
                this.velocity[key] = newVelocity;
                isMoving = true;
            }
        });

        return isMoving;
    }
}