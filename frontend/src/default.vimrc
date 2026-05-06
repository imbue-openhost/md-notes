" Default vimrc (based on ~/.ideavimrc)

let mapleader = ","

" Use jk for esc in insert mode
inoremap jk <Esc>
inoremap Jk <Esc>
inoremap JK <Esc>
inoremap jK <Esc>

" Case insensitive search (smart: case-sensitive if uppercase used)
set ignorecase
set smartcase
set incsearch

" Vim-easyclip emulation: d/x delete to black hole, m cuts
nnoremap d "_d
xnoremap d "_d
nnoremap dd "_dd
nnoremap D "_D
xnoremap D "_D
nnoremap x "_x
xnoremap x "_x
nnoremap m d
nnoremap mm dd
xnoremap m d

" Folding
exmap togglefold toggle-fold
exmap foldall fold-all
exmap unfoldall unfold-all
exmap foldcursor fold-at-cursor
exmap unfoldcursor unfold-at-cursor
nmap zo :togglefold<CR>
nmap zc :foldcursor<CR>
nmap za :togglefold<CR>
nmap zM :foldall<CR>
nmap zR :unfoldall<CR>

" Toggle GFM task checkbox on the current line
exmap toggletask toggle-task
nmap <leader>x :toggletask<CR>
