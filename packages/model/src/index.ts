type ModelKeys<TAttributes> = {
    readonly [key in keyof TAttributes]: TAttributes[key] extends ChildModelAttribute ? key : never;
}[keyof TAttributes];

export type ChildModelAttribute = undefined | IModel | IModel[];

/** Maps an model attributes for a parent model. */
export type ModelMap<TAttributes> = Pick<TAttributes, ModelKeys<TAttributes>>;

/** A set of errors for a model keyed by the model's property containing the error. */
export type ModelErrors<TAttributes> = {
    readonly [key in keyof TAttributes]?: string;
}

/** Defines the attributes for a model. */
export interface IModelAttributes {
    readonly id: string;
    readonly revision?: number;
}

/** Defines a model object. */
 export interface IModel<TAttributes extends IModelAttributes = IModelAttributes> {
    readonly id: string;
    readonly revision: number;
    readonly errors: ModelErrors<TAttributes>;

    clearError(attribute: keyof TAttributes): void;
    clearErrors(): void;
    hasError(attribute?: keyof TAttributes): boolean;
    isNew(): boolean;
    setErrorMessage(attribute: keyof TAttributes, message: string): void;    
    setRevision(revision: number): void;
    validate(attribute?: keyof TAttributes): boolean;
};

/** Handles model validation. */
export interface IModelValidation<TAttributes extends IModelAttributes, TModel extends IModel<TAttributes>> {
    validateAttribute(model: TModel, attribute: keyof TAttributes): void;
    validateModel(model: TModel): void
}

interface IModelValidator<TAttributes extends IModelAttributes> {
    validate(attribute?: keyof TAttributes): boolean;
}

/** Base class for a Model object. */
export abstract class Model<TAttributes extends IModelAttributes = IModelAttributes> implements IModel<TAttributes> {
    private validator?: IModelValidator<TAttributes>;
    private _errors: ModelErrors<TAttributes> = {};
    private _revision: number;

    constructor(readonly id = "", revision = 1) {
        this._revision = revision;
    }

    get errors(): ModelErrors<TAttributes> {
        return this._errors;
    }

    get revision(): number {
        return this._revision;
    }

    validate(attribute?: keyof TAttributes): boolean {
        this.validator = this.validator || this.createValidator();
        return this.validator.validate(attribute);
    }

    clearError(attribute: keyof TAttributes): void {
        const { [attribute]: value, ...errors } = this._errors;
        this._errors = <ModelErrors<TAttributes>>errors;
    }

    clearErrors(): void {
        this._errors = {};
        this.clearChildErrors();
    }

    hasError(attribute?: keyof TAttributes): boolean {
        return attribute 
            ? !!this.errors[attribute] || this.hasChildError(attribute)
            : Object.keys(this.errors).length > 0 || this.hasChildError();
    }

    isNew(): boolean {
        return !this.id;
    }

    /** Manually set an error message for the model. */
    setErrorMessage(attribute: keyof TAttributes, message: string): void {
        if (!message) {
            this.clearError(attribute);
        }
        else {
            this._errors = { ...this._errors, [attribute]: message };
        }
    }

    setRevision(revision: number): void {
        this._revision = revision;
    }

    /** 
     * Returns a validation object responsible for validating the current model. 
     * Note: validation objects do not need to handle validating child models directly.
     */
    protected abstract getValidation(): IModelValidation<TAttributes, this>;

    /** 
     * Returns a map of children for the current model; this is used when evaluating the state of the current model. 
     * If a model has children and implements this function then it does not have to be concerned with clearing errors for
     * a child or checking if any children have errors.
     */
    protected getChildren(): ModelMap<TAttributes> {
        return <ModelMap<TAttributes>>{};
    }

    private clearChildErrors(): void {
        this.forEachChild(child => child.clearErrors());
    }

    private createValidator(): IModelValidator<TAttributes> {
        const validation = this.getValidation();
        return {
            validate: attribute => {
                if (attribute) {
                    this.clearError(attribute);
                    validation.validateAttribute(this, attribute);
    
                    if (this.isChildModel(attribute)) {
                        this.validateChild(attribute);
                    }

                    return !this.hasError(attribute);
                }
        
                this.clearErrors();
                this.validateChildren();
                validation.validateModel(this);
                return !this.hasError();
            }
        };
    }

    private forEachChild(callback: (child: IModel) => void, child?: ChildModelAttribute): void {
        const iterateChild = (child?: ChildModelAttribute) => {
            if (child) {
                if (Array.isArray(child)) {
                    child.forEach(callback);
                }
                else {
                    callback(child);
                }
            }
        };

        if (child) {
            iterateChild(child);
        }
        else {
            const children = this.getChildren();
            Object.keys(children).forEach(key => iterateChild((<any>children)[key]));
        }
    }

    private getChild(attribute: keyof TAttributes): ChildModelAttribute {
        return (<any>this.getChildren())[attribute];
    }

    private hasChildError(attribute?: keyof TAttributes): boolean {
        let hasError = false;
        this.forEachChild(child => hasError = hasError || child.hasError(), attribute && this.getChild(attribute));
        return hasError;
    }

    private isChildModel(attribute: keyof TAttributes): boolean {
        const map = this.getChildren();
        return map.hasOwnProperty(attribute);
    }

    private validateChild(attribute: keyof TAttributes): void {
        this.forEachChild(child => child.validate(), this.getChild(attribute));
    }

    private validateChildren(): void {
        this.forEachChild(child => child.validate());
    }
}