" Default vimrc (based on ~/.ideavimrc)

" Use jk for esc in insert mode
inoremap jk <Esc>
inoremap Jk <Esc>
inoremap JK <Esc>
inoremap jK <Esc>

" Case insensitive search (smart: case-sensitive if uppercase used)
set ignorecase
set smartcase
set incsearch

" Use Q for formatting
map Q gq

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

" Editor settings
set number
set relativenumber
set tabstop=4
set shiftwidth=2
set expandtab
set wrap
set scrolloff=5
