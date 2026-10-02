// Retain codec assertions without depending on libc.
#define assert(condition) ((condition) ? (void)0 : __builtin_trap())
