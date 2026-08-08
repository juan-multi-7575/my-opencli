export interface CommandSchema {
    site: string;
    name: string;
    description: string;
    access: 'read' | 'write';
    args: any[];
    browser: boolean;
}

const schemas: CommandSchema[] = [];

export function cli(schema: CommandSchema) {
    schemas.push(schema);
}

export function getInternalRegistry() {
    return schemas;
}
