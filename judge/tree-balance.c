static BiTree read_tree(void) {
    int ch = nonspace();
    if (ch == '@' || ch == EOF) return NULL;
    BiTree node = malloc(sizeof(*node));
    node->data = ch;
    node->LChild = read_tree();
    node->RChild = read_tree();
    return node;
}
void run(void) {
    int height_only = read_int();
    BiTree root = read_tree();
    if (height_only) printf("%d\n", Height(root));
    else Pre_BF(root);
}
