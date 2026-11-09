const listTypes='typedef int ElementType;\ntypedef struct LNode *PtrToLNode;\nstruct LNode { ElementType Data; PtrToLNode Next; };\ntypedef PtrToLNode Position;\ntypedef PtrToLNode List;';
const graphTypes='enum { MaxVertexNum = 100 };\ntypedef int Vertex;\ntypedef char DataType;\ntypedef int WeightType;\ntypedef Vertex ElementType;\ntypedef int Position;\ntypedef struct AdjVNode *PtrToAdjVNode;\nstruct AdjVNode { Vertex AdjV; PtrToAdjVNode Next; };\ntypedef struct Vnode { PtrToAdjVNode FirstEdge; DataType Data; } AdjList[MaxVertexNum];\ntypedef struct GNode *LGraph;\nstruct GNode { int Nv, Ne; AdjList G; };\nint Visited[MaxVertexNum];\ntypedef struct QNode *Queue;\nstruct QNode { ElementType *Data; Position Front, Rear; int MaxSize; };\nQueue CreateQueue(int MaxSize);\nbool IsFull(Queue Q);\nbool IsEmpty(Queue Q);\nbool AddQ(Queue Q, ElementType X);\nElementType DeleteQ(Queue Q);';
const treeTypes='typedef char ElementType;\ntypedef struct NNode {\n    ElementType data;\n    struct NNode *LChild, *RChild;\n} BiTNode, *BiTree;';

export const problems=new Map([
  ['list-intersection',{
    subject:'data-structures',category:'线性表 · 单链表',title:'有序单链表求交集',
    statement:'实现 List Intersect(List L1, List L2)。L1、L2 是带头结点的单链表，数据结点为严格递增的正整数。返回新的带头结点的链表，按升序保存两个表共有的元素。无公共元素时也要返回带头结点的空表。不得修改原表或复用其结点。系统负责读入两个以 0 结束的序列，并打印返回结果。',
    types:listTypes,starter:'List Intersect(List L1, List L2) {\n    // 在这里实现函数\n    return NULL;\n}\n',
    sampleInput:'1 3 5 0\n2 3 5 6 8 10 0',sampleOutput:'The linear list: 3 5'
  }],
  ['graph-path',{
    subject:'data-structures',category:'图 · 广度优先搜索',title:'判断两个顶点间是否有路径',
    statement:'实现 bool HasPath(LGraph Graph, Vertex s, Vertex t)。图使用无向邻接表，最多 100 个顶点，s 和 t 都是合法下标。用广度优先搜索判断从 s 到 t 是否可达，s 等于 t 时返回 true。可使用提供的循环队列和 Visited 数组，系统在调用前将 Visited 清零。系统读入顶点数、边数、顶点字符、每条无向边的端点以及查询端点。',
    types:graphTypes,starter:'bool HasPath(LGraph Graph, Vertex s, Vertex t) {\n    // 在这里实现函数\n    return false;\n}\n',
    sampleInput:'6\n6\nA B C D E F\n0 1\n1 2\n2 3\n3 4\n4 5\n0 5\n0 4',
    sampleOutput:'从 0 到 4 存在路径。'
  }],
  ['tree-balance',{
    subject:'data-structures',category:'树与二叉树 · 先序遍历',title:'先序输出二叉树的平衡因子',
    statement:'补写 int Height(BiTree p) 与 void Pre_BF(BiTree t)。空树高度为 0，叶结点高度为 1。以根、左、右的先序遍历顺序，为每个结点输出一行 BF(字符)=整数，其中平衡因子为左子树高度减右子树高度。空树不输出。系统用完全先序序列建立二叉树，@ 表示空结点。',
    types:treeTypes,starter:'int Height(BiTree p) {\n    // 在这里实现函数\n    return 0;\n}\n\nvoid Pre_BF(BiTree t) {\n    // 在这里实现函数\n}\n',
    sampleInput:'ABD@@@CEG@@@F@@',sampleOutput:'BF(A)=-1\nBF(B)=1\nBF(D)=0\nBF(C)=1\nBF(E)=1\nBF(G)=0\nBF(F)=0'
  }]
]);

export function availableProblems(user){
  return [...problems].filter(([,p])=>user.subject===null || user.subject===p.subject);
}
