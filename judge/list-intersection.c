static List read_list(Position nodes[], ElementType values[], int *count) {
    List head = calloc(1, sizeof(*head)), tail = head;
    nodes[0] = head;
    *count = 1;
    for (int value; (value = read_int()) != 0;) {
        tail->Next = calloc(1, sizeof(*tail));
        tail = tail->Next;
        tail->Data = value;
        nodes[*count] = tail;
        values[(*count)++] = value;
    }
    return head;
}
static bool unchanged(Position nodes[], ElementType values[], int count) {
    for (int i = 0; i < count; i++)
        if (nodes[i]->Next != (i + 1 < count ? nodes[i + 1] : NULL)
            || (i && nodes[i]->Data != values[i])) return false;
    return true;
}
void run(void) {
    Position a[512], b[512];
    ElementType av[512], bv[512];
    int na, nb;
    List first = read_list(a, av, &na), second = read_list(b, bv, &nb);
    List result = Intersect(first, second);
    if (!result || !unchanged(a, av, na) || !unchanged(b, bv, nb)) __builtin_trap();
    printf("The linear list:");
    int count = 0;
    for (Position p = result; p; p = p->Next) {
        if (count > na || count > nb) __builtin_trap();
        for (int i = 0; i < na; i++) if (a[i] == p) __builtin_trap();
        for (int i = 0; i < nb; i++) if (b[i] == p) __builtin_trap();
        if (count++) printf(" %d", p->Data);
    }
    putchar('\n');
}
