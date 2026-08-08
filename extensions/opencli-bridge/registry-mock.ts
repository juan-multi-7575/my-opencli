export const Strategy = {
    PUBLIC: 'public',
    PRIVATE: 'private',
};
export const cli = (schema: any) => {
    (global as any)._registeredSchemas.push(schema);
};
