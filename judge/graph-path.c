Queue CreateQueue(int MaxSize) {
    Queue Q = malloc(sizeof(*Q));
    if (!Q || MaxSize < 2) return NULL;
    Q->Data = malloc(sizeof(*Q->Data) * MaxSize);
    if (!Q->Data) return NULL;
    Q->Front = Q->Rear = 0;
    Q->MaxSize = MaxSize;
    return Q;
}
bool IsFull(Queue Q) { return (Q->Rear + 1) % Q->MaxSize == Q->Front; }
bool IsEmpty(Queue Q) { return Q->Rear == Q->Front; }
bool AddQ(Queue Q, ElementType X) {
    if (IsFull(Q)) return false;
    Q->Rear = (Q->Rear + 1) % Q->MaxSize;
    Q->Data[Q->Rear] = X;
    return true;
}
ElementType DeleteQ(Queue Q) {
    if (IsEmpty(Q)) return ERROR;
    Q->Front = (Q->Front + 1) % Q->MaxSize;
    return Q->Data[Q->Front];
}
static void add_edge(LGraph graph, Vertex from, Vertex to) {
    PtrToAdjVNode node = malloc(sizeof(*node));
    node->AdjV = to;
    node->Next = graph->G[from].FirstEdge;
    graph->G[from].FirstEdge = node;
}
void run(void) {
    LGraph graph = calloc(1, sizeof(*graph));
    graph->Nv = read_int();
    graph->Ne = read_int();
    for (int i = 0; i < graph->Nv; i++) graph->G[i].Data = nonspace();
    for (int i = 0; i < graph->Ne; i++) {
        Vertex from = read_int(), to = read_int();
        add_edge(graph, from, to);
        add_edge(graph, to, from);
    }
    Vertex s = read_int(), t = read_int();
    printf("%d\n", HasPath(graph, s, t) ? 1 : 0);
}
