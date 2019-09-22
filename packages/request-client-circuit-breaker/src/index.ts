import { IRequestInterceptor, IRequestInterceptorContext, IResponseInterceptor, IResponseInterceptorContext, RequestError, RequestErrorCode } from "@sprig/request-client";

export enum CircuitBreakerState {
    closed = "closed",
    halfOpen = "half-open",
    open = "open"
}

type NotOptional<T> = { readonly [key in keyof T]-?: T[key] };

export interface ICircuitBreaker extends IRequestInterceptor {
    /** The metrics used by the circuit breaker. */
    readonly metrics: ICircuitBreakerMetrics;
    /** The current state of the circuit breaker. */
    readonly state: CircuitBreakerState;
}

export interface ICircuitBreakerMetrics extends IResponseInterceptor {
    /** Gets the number of responses currently tracked by the metrics. */
    readonly count: number;
    /** Gets the number of failed responses currently tracked by the metrics. */
    readonly failureCount: number;
    /** Gets the current failure rate (as a percentage). */
    readonly failureRate: number;    
}

export interface ICircuitBreakerOptions {
    /** A name or identifier for the circuit breaker. */
    readonly name: string;
    /** Defines the failure rate threshold (as a percentage) required to open the circuit breaker; the default is 50. */
    readonly threshold?: number;
    /** Defines the duration (in milliseconds) in which the circuit remains open before switching to a half-open state; the default is 10,000 milliseconds. */
    readonly openDuration?: number;
    /** Defines the buffer size while in a closed state; the default is 100. */
    readonly bufferSizeClosed?: number;
    /** Defines the buffer size while in a half-open state; the default is 10. */
    readonly bufferSizeHalfOpen?: number;
    /** A callback to determine if the specified request error should be recorded as an error; by default errors related to a network or service being unavailable or a timeout will be recorded. */
    readonly recordError?: (error: RequestError) => boolean;
}

interface ICircuitBreakerState {
    readonly state: CircuitBreakerState;
    getCount(): number;
    getFailureCount(): number;
    getFailureRate(): number;
    onResponse(context: IResponseInterceptorContext, nextState: (next: ICircuitBreakerState) => void): void;
    onRequest(context: IRequestInterceptorContext, nextState: (next: ICircuitBreakerState) => void): void;
}

const registry = new Map<string, ICircuitBreaker>();

const defaultThreshold = 50;
const defaultOpenDuration = 10000;
const defaultBufferSizeClosed = 100;
const defaultBufferSizeHalfOpen = 10;
const defaultRecordError = (error: RequestError) => 
    error.code === RequestErrorCode.networkUnavailable ||
    error.code === RequestErrorCode.serviceUnavailable ||
    error.code === RequestErrorCode.timeout;

/** 
 * Represents a set of bits with a defined capacity; once the capcity is reached
 * additional bits will be set starting at index 0 overwriting previous bits.
 */
class BitRing {
    // numbers in javascript are 64 bit floating point numbers
    private readonly words: number[];
    private currentIndex = 0;
    private _cardinality = 0;
    private _count = 0;

    /** The maximum number of bits in the set. */
    readonly capacity: number;

    constructor(capacity: number) {
        if (capacity < 1) {
            throw new Error("Capacity must be greater than 0.");
        }

        this.capacity = capacity;
        const wordsArraySize = this.getWordIndex(this.capacity - 1) + 1;
        this.words = new Array(wordsArraySize);
        for (let i = 0; i < wordsArraySize; i++) {
            this.words[i] = 0;
        }
    }

    /** Gets the number of bits set to true. */
    get cardinality(): number {
        return this._cardinality;
    }

    /** Gets the actual number (up-to the capacity) of bits set. */
    get count(): number {
        return this._count;
    }

    /** Sets the next bit in the ring and returns the updated cardinality. */
    setNextBit(value: boolean): number {
        if (this._count < this.capacity) {
            this._count++;
        }

        const previous = this.setBitAtIndex(this.currentIndex++, value);
        const current = value ? 1 : 0;

        this._cardinality = this._cardinality - previous + current;

        if (this.currentIndex === this.capacity) {
            this.currentIndex = 0;
        }

        return this.cardinality;
    }

    private setBitAtIndex(bitIndex: number, value: boolean): number {
        const wordIndex = this.getWordIndex(bitIndex);
        const bitMask = 1 << bitIndex;
        const previous = (this.words[wordIndex] & bitMask) !== 0 ? 1 : 0;

        if (value) {
            this.words[wordIndex] |= bitMask;
        }
        else {
            this.words[wordIndex] &= ~bitMask;
        }

        return previous;
    }

    private getWordIndex(bitIndex: number): number {
        // 64 bits per big int - need to determine the index in the words array for the
        // given bit index, e.g. bit index of 65 would be index 1 in the words array
        return bitIndex >> 6;
    }    
}

/** Tracks the number of successful and failed calls for the Circuit Breaker. */
class CircuitBreakerMetrics {
    private readonly ring: BitRing;

    constructor(ringSize: number) {
        this.ring = new BitRing(ringSize);
    }

    /** Gets the count of bits currently tracked. */
    getCount(): number {
        return this.ring.count;
    }

    /** Gets the current number of errors. */
    getFailureCount(): number {
        return this.ring.cardinality;
    }

    /** Gets the current failure rate (as percentage). */
    getFailureRate(): number {
        return this.calculateFailureRate(this.getFailureCount());
    }

    onError(): number {
        return this.calculateFailureRate(this.ring.setNextBit(true));
    }

    onSuccess(): number {
        return this.calculateFailureRate(this.ring.setNextBit(false));
    }

    private calculateFailureRate(failCount: number): number {
        return failCount * 100 / this.getCount();
    }
}

function updateMetrics(context: IResponseInterceptorContext, options: NotOptional<ICircuitBreakerOptions>, metrics: CircuitBreakerMetrics): void {
    if (context.error && options.recordError(context.error)) {
        metrics.onError();
    }
    else {
        metrics.onSuccess();
    }
}

function close(options: NotOptional<ICircuitBreakerOptions>): ICircuitBreakerState {
    return new class CloseState {
        private readonly metrics = new CircuitBreakerMetrics(options.bufferSizeClosed);

        readonly state = CircuitBreakerState.closed;

        getCount(): number {
            return this.metrics.getCount();
        }

        getFailureCount(): number {
            return this.metrics.getFailureCount();
        }

        getFailureRate(): number {
            return this.metrics.getFailureRate();
        }

        onResponse(context: IResponseInterceptorContext, nextState: (next: ICircuitBreakerState) => void): void {
            updateMetrics(context, options, this.metrics);
            
            if (this.metrics.getCount() === options.bufferSizeClosed && options.threshold <= this.metrics.getFailureRate()) {
                nextState(open(options));
            }

            context.next();
        }

        onRequest(context: IRequestInterceptorContext): void {
            context.next();
        }
    };
}

function halfOpen(options: NotOptional<ICircuitBreakerOptions>): ICircuitBreakerState {
    return new class HalfOpenState {
        private readonly metrics = new CircuitBreakerMetrics(options.bufferSizeHalfOpen);

        readonly state = CircuitBreakerState.halfOpen;

        getCount(): number {
            return this.metrics.getCount();
        }

        getFailureCount(): number {
            return this.metrics.getFailureCount();
        }

        getFailureRate(): number {
            return this.metrics.getFailureRate();
        }

        onResponse(context: IResponseInterceptorContext, nextState: (next: ICircuitBreakerState) => void): void {
            updateMetrics(context, options, this.metrics);

            if (this.metrics.getCount() === options.bufferSizeHalfOpen) {
                nextState(
                    options.threshold <= this.metrics.getFailureRate()
                    ? open(options)
                    : close(options));
            }

            context.next();           
        }

        onRequest(context: IRequestInterceptorContext): void {
            context.next();
        }
    };
}

function open(options: NotOptional<ICircuitBreakerOptions>): ICircuitBreakerState {
    return new class OpenState {
        private readonly timestamp = Date.now();

        readonly state = CircuitBreakerState.open;

        getCount(): number {
            return 0;
        }

        getFailureCount(): number {
            return 0;
        }

        getFailureRate(): number {
            return 0;
        }

        onResponse(context: IResponseInterceptorContext): void {
            context.next();
        }

        onRequest(context: IRequestInterceptorContext, nextState: (next: ICircuitBreakerState) => void): void {
            if (this.hasExpired()) {
                // the duration has expired so switch over to half-open and forward the request
                const state = halfOpen(options);
                nextState(state);
                return state.onRequest(context, nextState);
            }

            context.reject(new RequestError({
                code: RequestErrorCode.serviceUnavailable,
                message: `Circuit breaker (${options.name}) is open and not allowing further requests.`,
                request: context.request
            }));
        }

        private hasExpired(): boolean {
            return (Date.now() - this.timestamp) > options.openDuration;
        }
    };
}

function create(options: NotOptional<ICircuitBreakerOptions>): ICircuitBreaker {
    let state = close(options);
    const circuitBreaker: IRequestInterceptor = context => state.onRequest(context, nextState => state = nextState);
    const metrics: IResponseInterceptor = context => state.onResponse(context, nextState => state = nextState);

    Object.defineProperty(metrics, "count", { 
        get() { return state.getCount(); }
    });
    Object.defineProperty(metrics, "failureCount", { 
        get() { return state.getFailureCount(); }
    });
    Object.defineProperty(metrics, "failureRate", { 
        get() { return state.getFailureRate(); }
    });    

    Object.defineProperty(circuitBreaker, "metrics", { value: metrics });
    Object.defineProperty(circuitBreaker, "state", { 
        get() { return state.state; } 
    });

    return <ICircuitBreaker>circuitBreaker;
}

/** 
 * Creates a new circuit breaker. A circuit breaker needs to be hooked into both of the request and
 * response interceptor pipeline for a request. The circuit breaker itself is a request interceptor
 * and can be injected directly: 
 * 
 * request.use(circuitBreaker);
 * 
 * In order to track the metrics needed by the circuit breaker its metrics property needs to be injected
 * as a response interceptor for the request:
 * 
 * request
 *     .use(circuitBreaker)
 *     .invoke()
 *     .thenUse(circuitBreaker.metrics);
 */
export function createCircuitBreaker(options: ICircuitBreakerOptions): ICircuitBreaker {
    return create({
        name: options.name,
        threshold: options.threshold || defaultThreshold,
        openDuration: options.openDuration || defaultOpenDuration,
        bufferSizeClosed: options.bufferSizeClosed || defaultBufferSizeClosed,
        bufferSizeHalfOpen: options.bufferSizeHalfOpen || defaultBufferSizeHalfOpen,
        recordError: options.recordError || defaultRecordError
    });
}

/** Creates and registers a global circuit breaker instance. */
export function registerCircuitBreaker(options: ICircuitBreakerOptions): ICircuitBreaker {
    if (registry.has(options.name)) {
        throw new Error(`Circuit breaker ${options.name} already registered.`);
    }

    const circuitBreaker = createCircuitBreaker(options);
    registry.set(options.name, circuitBreaker);

    return circuitBreaker;
}

/** Gets a circuit breaker by name that has been registered globally. */
export function circuitBreaker(name: string): ICircuitBreaker {
    const cb = registry.get(name);

    if (!cb) {
        throw new Error(`Circuit breaker ${name} not registered.`);
    }

    return cb;
}