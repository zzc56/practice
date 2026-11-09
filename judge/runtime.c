typedef __SIZE_TYPE__ size_t;
#define NULL ((void *)0)
#define EOF (-1)
#define ERROR (-1)
#define bool _Bool
#define true 1
#define false 0
extern int judge_read(void);
extern void judge_write(int);
extern unsigned char __heap_base;
static size_t heap;
void *malloc(size_t n) {
    if (!heap) heap = (size_t)&__heap_base;
    if (n > 8388608 || heap > 8388608 - n - 8) return NULL;
    size_t start = heap;
    heap += (n + 7) & ~(size_t)7;
    return (void *)start;
}
void free(void *p) { (void)p; }
void *calloc(size_t count, size_t width) {
    if (width && count > 8388608 / width) return NULL;
    return malloc(count * width);
}
int putchar(int ch) { judge_write(ch & 255); return ch; }
static int pending = -2;
int getchar(void) {
    if (pending == -2) return judge_read();
    int ch = pending;
    pending = -2;
    return ch;
}
static int nonspace(void) {
    int ch;
    do { ch = getchar(); } while (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n');
    return ch;
}
static int read_int(void) {
    int ch = nonspace(), sign = 1, value = 0;
    if (ch == '-') { sign = -1; ch = getchar(); }
    while (ch >= '0' && ch <= '9') {
        value = value * 10 + ch - '0';
        ch = getchar();
    }
    pending = ch;
    return sign * value;
}
static int print_text(const char *s) {
    int length = 0;
    while (*s) { putchar((unsigned char)*s++); length++; }
    return length;
}
int puts(const char *s) { return print_text(s) + (putchar('\n') == '\n'); }
int printf(const char *format, ...) {
    __builtin_va_list args;
    __builtin_va_start(args, format);
    int length = 0;
    while (*format) {
        int ch = (unsigned char)*format++;
        if (ch != '%') { putchar(ch); length++; continue; }
        switch (*format ? *format++ : '\0') {
        case '%': putchar('%'); length++; break;
        case 'c': putchar(__builtin_va_arg(args, int)); length++; break;
        case 's': length += print_text(__builtin_va_arg(args, const char *)); break;
        case 'd': case 'i': {
            int v = __builtin_va_arg(args, int);
            unsigned value = (unsigned)v;
            if (v < 0) { putchar('-'); length++; value = 0u - value; }
            char digits[10];
            int count = 0;
            do { digits[count++] = '0' + value % 10; value /= 10; } while (value);
            length += count;
            while (count) putchar(digits[--count]);
            break;
        }
        default: __builtin_trap();
        }
    }
    __builtin_va_end(args);
    return length;
}
